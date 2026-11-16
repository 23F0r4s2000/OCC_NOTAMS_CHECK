
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FAA_CLIENT_ID = Deno.env.get("FAA_CLIENT_ID")!;
const FAA_CLIENT_SECRET = Deno.env.get("FAA_CLIENT_SECRET")!;

const FAA_AUTH_URL = "https://api-nms.aim.faa.gov/v1/auth/token";
const FAA_NOTAM_URL = "https://api-nms.aim.faa.gov/nmsapi/v1/notams";

const DAYS_AHEAD = 7;

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

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function getFaaToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: FAA_CLIENT_ID,
    client_secret: FAA_CLIENT_SECRET,
  });

  const result = await fetch(FAA_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!result.ok) {
    throw new Error(`FAA authentication failed: ${result.status}`);
  }

  const data = await result.json();

  if (!data.access_token) {
    throw new Error("FAA access_token missing");
  }

  return data.access_token;
}

function isRelevantNotam(notam: any): boolean {
  const now = new Date();
  const limit = new Date(
    now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000
  );

  const start = new Date(notam.effectiveStart);

  if (Number.isNaN(start.getTime()) || start > limit) {
    return false;
  }

  if (notam.effectiveEnd === "PERM") {
    return true;
  }

  const end = new Date(notam.effectiveEnd);

  return !Number.isNaN(end.getTime()) && end >= now;
}

async function deleteExpiredNotams(icao: string) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("tbl_notams")
    .delete()
    .eq("apt", icao)
    .neq("end_date", "PERM")
    .lt("end_date", now);

  if (error) {
    throw new Error(
      `Cannot delete expired NOTAMs for ${icao}: ${error.message}`
    );
  }
}

async function getAirportNotams(
  icao: string,
  token: string
): Promise<any[]> {
  const url = new URL(FAA_NOTAM_URL);
  url.searchParams.set("location", icao);

  const result = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      nmsResponseFormat: "AIXM",
      Accept: "application/json",
    },
  });

  if (!result.ok) {
    throw new Error(
      `FAA request failed for ${icao}: ${result.status}`
    );
  }

  const data = await result.json();

  if (data.status !== "Success") {
    throw new Error(`FAA returned an unsuccessful response for ${icao}`);
  }

  return data.data?.geojson ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const now = new Date();

    // 1. Recupera gli aeroporti da controllare
    const { data: airports, error: airportError } = await supabase
      .from("tbl_apt")
      .select("ICAO, IATA, name, state")
      .order("state")
      .order("ICAO");

    if (airportError) throw airportError;

    if (!airports?.length) {
      throw new Error("No airports found in tbl_apt");
    }

    // 2. Elimina i NOTAM scaduti per ogni aeroporto
    for (const airport of airports) {
      await deleteExpiredNotams(airport.ICAO);
    }

    // 3. Richiede un nuovo token FAA
    const token = await getFaaToken();

    let totalReceived = 0;
    let totalRelevant = 0;
    let totalUpserted = 0;

    const airportResults = [];

    // 4. Interroga FAA per ogni aeroporto
    for (const airport of airports) {
      const icao = airport.ICAO;

      const features = await getAirportNotams(icao, token);

      totalReceived += features.length;

      const records = [];

      // 5. Filtra e converte i NOTAM
      for (const feature of features) {
        const notam =
          feature?.properties?.coreNOTAMData?.notam;

        if (!notam || !isRelevantNotam(notam)) {
          continue;
        }

        // Identificazione basata sul numero NOTAM.
        // apt + number costituiscono la chiave di merge.
        const translation =
          feature?.properties?.coreNOTAMData?.notamTranslation ?? [];

        const icaoTranslation = translation.find(
          (item: any) => item.type === "ICAO"
        );

        records.push({
          apt: notam.icaoLocation || notam.location || icao,
          number: notam.number,
          classification: notam.classification ?? null,
          issue_date: notam.issued ?? null,
          start_date: notam.effectiveStart ?? null,
          end_date: notam.effectiveEnd ?? null,
          short_text: notam.text ?? "",
          plain_text: icaoTranslation?.formattedText ?? "",
        });
      }

      totalRelevant += records.length;

      // 6. Merge su apt + number
      if (records.length > 0) {
        const { error } = await supabase
          .from("tbl_notams")
          .upsert(records, {
            onConflict: "apt,number",
          });

        if (error) {
          throw new Error(
            `Upsert failed for ${icao}: ${error.message}`
          );
        }

        totalUpserted += records.length;
      }

      airportResults.push({
        icao,
        name: airport.name,
        received: features.length,
        relevant: records.length,
      });
    }

    // 7. Aggiorna la data dell'ultimo controllo
    const { error: checkError } = await supabase
      .from("tbl_check")
      .upsert(
        {
          id: 1,
          last_check_date: now.toISOString(),
        },
        { onConflict: "id" }
      );

    if (checkError) throw checkError;

    return response({
      success: true,
      check_date: now.toISOString(),
      airports_checked: airports.length,
      total_received: totalReceived,
      total_relevant: totalRelevant,
      total_upserted: totalUpserted,
      airports: airportResults,
    });

  } catch (error) {
    console.error(error);

    return response({
      success: false,
      error: error instanceof Error
        ? error.message
        : "Unknown error",
    }, 500);
  }
});
