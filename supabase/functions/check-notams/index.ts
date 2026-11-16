
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FAA_CLIENT_ID = Deno.env.get("FAA_CLIENT_ID")!;
const FAA_CLIENT_SECRET = Deno.env.get("FAA_CLIENT_SECRET")!;

const FAA_AUTH_URL = "https://api-nms.aim.faa.gov/v1/auth/token";
const FAA_NOTAM_URL = "https://api-nms.aim.faa.gov/nmsapi/v1/notams";

const AIRPORT_DELAY_MS = 2000;
const MAX_RETRIES = 3;
const UPSERT_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 100;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==========================================
   FAA AUTHENTICATION
========================================== */

async function getFaaToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: FAA_CLIENT_ID,
    client_secret: FAA_CLIENT_SECRET,
  });

  const response = await fetch(FAA_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `FAA authentication failed: ${response.status} - ${await response.text()}`
    );
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("FAA access_token missing");
  }

  return data.access_token;
}

/* ==========================================
   FAA NOTAM REQUEST
========================================== */

async function getAirportNotams(
  icao: string,
  token: string
): Promise<any[]> {

  const url = new URL(FAA_NOTAM_URL);
  url.searchParams.set("location", icao);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        nmsResponseFormat: "GEOJSON",
        Accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();

      if (data.status !== "Success") {
        throw new Error(
          `FAA unsuccessful response for ${icao}: ${JSON.stringify(data)}`
        );
      }

      const features = data.data?.geojson;

      if (!Array.isArray(features)) {
        throw new Error(
          `Unexpected FAA response format for ${icao}. Data keys: ${
            Object.keys(data.data ?? {}).join(", ")
          }`
        );
      }

      console.log(`FAA ${icao}: ${features.length} NOTAMs received`);

      return features;
    }

    const errorBody = await response.text();

    if (response.status === 429 && attempt < MAX_RETRIES) {

      const retryAfter = response.headers.get("Retry-After");

      let waitTime = Math.pow(2, attempt + 1) * 5000;

      if (retryAfter) {
        const seconds = Number(retryAfter);

        if (Number.isFinite(seconds) && seconds > 0) {
          waitTime = seconds * 1000;
        } else {
          const retryDate = new Date(retryAfter).getTime();

          if (!Number.isNaN(retryDate)) {
            waitTime = Math.max(1000, retryDate - Date.now());
          }
        }
      }

      console.log(
        `FAA 429 for ${icao}. Retry ${attempt + 1} in ${waitTime} ms`
      );

      await sleep(waitTime);
      continue;
    }

    throw new Error(
      `FAA request failed for ${icao}: ${response.status} - ${errorBody}`
    );
  }

  throw new Error(`FAA retries exhausted for ${icao}`);
}

/* ==========================================
   CONVERT AND FILTER NOTAMS
========================================== */

function convertNotam(feature: any, airportIcao: string) {

  const notam =
    feature?.properties?.coreNOTAMData?.notam;

  if (!notam?.number) {
    return null;
  }

  // Only international NOTAMs are stored.
  if (
    String(notam.classification ?? "").toUpperCase() !== "INTL"
  ) {
    return null;
  }

  const translations =
    feature?.properties?.coreNOTAMData?.notamTranslation ?? [];

  const icaoTranslation = translations.find(
    (item: any) => item.type === "ICAO"
  );

  const endDate = notam.effectiveEnd ?? null;

  // Permanent NOTAMs are retained.
  if (endDate && String(endDate).toUpperCase() !== "PERM") {
    const parsedEndDate = new Date(endDate);

    if (
      !Number.isNaN(parsedEndDate.getTime()) &&
      parsedEndDate.getTime() < Date.now()
    ) {
      return null;
    }
  }

  return {
    apt: notam.icaoLocation || notam.location || airportIcao,
    number: notam.number,
    classification: notam.classification,
    issue_date: notam.issued ?? null,
    start_date: notam.effectiveStart ?? null,
    end_date: endDate,
    short_text: notam.text ?? "",
    plain_text: icaoTranslation?.formattedText ?? "",
  };
}

/* ==========================================
   UPSERT NOTAMS
========================================== */

async function upsertNotams(records: any[]) {

  let totalUpserted = 0;

  for (
    let i = 0;
    i < records.length;
    i += UPSERT_BATCH_SIZE
  ) {

    const batch = records.slice(
      i,
      i + UPSERT_BATCH_SIZE
    );

    const { error } = await supabase
      .from("tbl_notams")
      .upsert(batch, {
        onConflict: "apt,number",
      });

    if (error) {
      throw new Error(
        `Supabase upsert error: ${error.message}`
      );
    }

    totalUpserted += batch.length;
  }

  return totalUpserted;
}

/* ==========================================
   DELETE EXPIRED NOTAMS FROM DATABASE
========================================== */


async function deleteExpiredNotams() {

  const now = Date.now();

  let offset = 0;
  const expiredIds: number[] = [];

  while (true) {

    const { data, error } = await supabase
      .from("tbl_notams")
      .select("id,end_date")
      .order("id")
      .range(offset, offset + 999);

    if (error) {
      throw new Error(
        `Cannot read NOTAMs for expiry cleanup: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const record of data) {

      if (!record.end_date) continue;

      if (
        String(record.end_date).toUpperCase() === "PERM"
      ) {
        continue;
      }

      const end = new Date(record.end_date);

      if (
        !Number.isNaN(end.getTime()) &&
        end.getTime() < now
      ) {
        expiredIds.push(record.id);
      }
    }

    offset += data.length;

    if (data.length < 1000) {
      break;
    }
  }

  let totalDeleted = 0;

  for (
    let i = 0;
    i < expiredIds.length;
    i += DELETE_BATCH_SIZE
  ) {

    const batch = expiredIds.slice(
      i,
      i + DELETE_BATCH_SIZE
    );

    const { error } = await supabase
      .from("tbl_notams")
      .delete()
      .in("id", batch);

    if (error) {
      throw new Error(
        `Cannot delete expired NOTAMs: ${error.message}`
      );
    }

    totalDeleted += batch.length;
  }

  return totalDeleted;
}

/* ==========================================
   MAIN FUNCTION
========================================== */

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({
      success: false,
      error: "Method not allowed",
    }, 405);
  }

  try {

    const checkStartedAt = new Date();

    /* 1. LOAD AIRPORTS */

    const { data: airports, error: airportError } =
      await supabase
        .from("tbl_apt")
        .select("ICAO,IATA,name,state")
        .order("state")
        .order("ICAO");

    if (airportError) {
      throw new Error(
        `Cannot load airports: ${airportError.message}`
      );
    }

    if (!airports?.length) {
      throw new Error("No airports found in tbl_apt");
    }

    /* 2. FAA AUTHENTICATION */

    const token = await getFaaToken();

    let totalReceived = 0;
    let totalIntlReceived = 0;
    let totalUpserted = 0;

    const airportResults: any[] = [];
    const failures: any[] = [];

    /* 3. CHECK EACH AIRPORT */

    for (let index = 0; index < airports.length; index++) {

      const airport = airports[index];
      const icao = airport.ICAO;

      try {

        console.log(`Checking ${icao}`);

        const features = await getAirportNotams(
          icao,
          token
        );

        totalReceived += features.length;

        const recordsMap = new Map<string, any>();

        for (const feature of features) {

          const record = convertNotam(feature, icao);

          if (!record) continue;

          totalIntlReceived++;

          const key = `${record.apt}|${record.number}`;

          recordsMap.set(key, record);
        }

        const records = Array.from(recordsMap.values());

        const upserted = await upsertNotams(records);

        totalUpserted += upserted;

        airportResults.push({
          icao,
          name: airport.name,
          received: features.length,
          intl_received: records.length,
          upserted,
          success: true,
        });

      } catch (error) {

        const message = error instanceof Error
          ? error.message
          : "Unknown error";

        console.error(`Error checking ${icao}: ${message}`);

        failures.push({
          icao,
          error: message,
        });

        airportResults.push({
          icao,
          name: airport.name,
          success: false,
          error: message,
        });
      }

      if (index < airports.length - 1) {
        await sleep(AIRPORT_DELAY_MS);
      }
    }

    /* 4. REMOVE EXPIRED DATABASE RECORDS */

    const deletedExpired = await deleteExpiredNotams();

    /* 5. UPDATE LAST CHECK ONLY IF ALL AIRPORTS SUCCEEDED */

    const completedAt = new Date();

    if (failures.length === 0) {

      const { error: checkError } = await supabase
        .from("tbl_check")
        .upsert({
          id: 1,
          last_check_date: completedAt.toISOString(),
        }, {
          onConflict: "id",
        });

      if (checkError) {
        throw new Error(
          `Cannot update tbl_check: ${checkError.message}`
        );
      }
    }

    /* 6. RESPONSE */

    return jsonResponse({
      success: failures.length === 0,
      partial: failures.length > 0,
      check_started_at: checkStartedAt.toISOString(),
      check_completed_at: completedAt.toISOString(),
      airports_checked: airports.length,
      airports_succeeded: airports.length - failures.length,
      airports_failed: failures.length,
      total_received: totalReceived,
      total_intl_received: totalIntlReceived,
      total_upserted: totalUpserted,
      expired_deleted: deletedExpired,
      failures,
      airports: airportResults,
    });

  } catch (error) {

    console.error("CHECK NOTAMS ERROR:", error);

    return jsonResponse({
      success: false,
      error: error instanceof Error
        ? error.message
        : "Unknown error",
    }, 500);
  }
});
