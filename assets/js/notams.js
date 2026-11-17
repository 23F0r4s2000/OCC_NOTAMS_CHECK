
/* =====================================================
   SUPABASE CONFIGURATION
===================================================== */

const SUPABASE_URL = "https://yjhtjgqajtiqsyezdcfp.supabase.co";
const SUPABASE_KEY = "sb_publishable_h2QLk6TMCDnVRP_WEAznNw_EtmCB-1D";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let airportData = [];
let notamData = [];
let currentPlainText = "";


/* =====================================================
   INITIALIZATION
===================================================== */

$(document).ready(function () {
    initializeNotamsTheme();

    $("#themeToggle").on("click", toggleNotamsTheme);
    $("#copyIcaoText").on("click", copyIcaoText);

    $("#notamsContainer, #airportNotamsList").on(
        "click",
        ".notam-open-button",
        function () {
            showIcaoText(this);
        }
    );

    $("#notamsSearch").on("input", function () {
        $("#clearNotamsSearch").toggle($(this).val().length > 0);
        renderNotamsOverview();
    });

    $("#clearNotamsSearch").on("click", function () {
        $("#notamsSearch").val("");
        $(this).hide();
        renderNotamsOverview();
    });

    if ($("#notamsContainer").length) {
        loadNotamsOverview();
    }

    if ($("#airportNotamsList").length) {
        loadAirportNotams();
    }
});


/* =====================================================
   THEME
===================================================== */

function initializeNotamsTheme() {
    const theme = localStorage.getItem("en_notam_theme") || "dark";

    $("html").attr("data-theme", theme);
    updateNotamsThemeButton(theme);
}

function toggleNotamsTheme() {
    const current = $("html").attr("data-theme");
    const next = current === "dark" ? "light" : "dark";

    $("html").attr("data-theme", next);
    localStorage.setItem("en_notam_theme", next);

    updateNotamsThemeButton(next);
}

function updateNotamsThemeButton(theme) {
    $("#themeToggle").html(
        theme === "dark"
            ? '<i class="bi bi-sun-fill"></i>'
            : '<i class="bi bi-moon-fill"></i>'
    );
}


/* =====================================================
   LOAD ALL ROWS - SUPABASE PAGINATION
===================================================== */

async function loadAllRows(table, columns, filters = []) {
    const pageSize = 1000;
    let allRows = [];
    let from = 0;

    while (true) {
        let query = supabaseClient
            .from(table)
            .select(columns)
            .range(from, from + pageSize - 1);

        filters.forEach(filter => {
            query = query[filter.method](
                filter.column,
                filter.value
            );
        });

        const { data, error } = await query;

        if (error) throw error;

        const rows = data || [];
        allRows = allRows.concat(rows);

        if (rows.length < pageSize) break;

        from += pageSize;
    }

    return allRows;
}


/* =====================================================
   NOTAM NUMBER SORTING
   Example:
   A7647/26 > A7646/26 > A6606/26
===================================================== */

function parseNotamNumber(number) {
    const match = String(number || "")
        .trim()
        .match(/^[A-Z]+(\d+)\/(\d+)$/i);

    if (!match) {
        return {
            sequence: -1,
            year: -1
        };
    }

    return {
        sequence: parseInt(match[1], 10),
        year: parseInt(match[2], 10)
    };
}

function compareNotamNumbers(a, b) {
    const first = parseNotamNumber(a.number);
    const second = parseNotamNumber(b.number);

    if (first.year !== second.year) {
        return second.year - first.year;
    }

    if (first.sequence !== second.sequence) {
        return second.sequence - first.sequence;
    }

    return String(b.number || "").localeCompare(
        String(a.number || "")
    );
}


/* =====================================================
   ACTIVE NOTAM VALIDITY
===================================================== */

function isNotamCurrentlyActive(notam) {
    const now = new Date();

    if (!notam.start_date) return false;

    const start = new Date(notam.start_date);

    if (Number.isNaN(start.getTime()) || start > now) {
        return false;
    }

    const endValue = String(notam.end_date || "")
        .trim()
        .toUpperCase();

    if (endValue === "PERM") {
        return true;
    }

    if (!endValue) return false;

    const end = new Date(endValue);

    return !Number.isNaN(end.getTime()) && end >= now;
}


/* =====================================================
   LOAD OVERVIEW
===================================================== */

async function loadNotamsOverview() {
    $("#notamsContainer").html(`
        <div class="loading-state">
            <span class="spinner-border spinner-border-sm me-2"></span>
            Loading NOTAMs...
        </div>
    `);

    try {
        const [airports, notams, check] = await Promise.all([
            loadAllRows(
                "tbl_apt",
                "ICAO,IATA,name,state"
            ),
            loadAllRows(
                "tbl_notams",
                "apt,number,classification,issue_date,start_date,end_date,short_text,plain_text"
            ),
            supabaseClient
                .from("tbl_check")
                .select("last_check_date")
                .eq("id", 1)
                .maybeSingle()
        ]);

        if (check.error) throw check.error;

        airportData = airports || [];

        notamData = (notams || [])
            .filter(isNotamCurrentlyActive)
            .sort(compareNotamNumbers);

        $("#totalActiveNotams").text(notamData.length);

        updateNotamsLastCheck(check.data?.last_check_date);

        renderNotamsOverview();

    } catch (error) {
        console.error("NOTAM overview error:", error);

        $("#notamsContainer").html(`
            <div class="alert alert-danger">
                Unable to load NOTAMs:
                ${escapeNotamsHtml(error.message)}
            </div>
        `);
    }
}


/* =====================================================
   OVERVIEW RENDERING
===================================================== */

function renderNotamsOverview() {
    const search = ($("#notamsSearch").val() || "")
        .trim()
        .toLowerCase();

    const airportsWithNotams = airportData
        .map(airport => {
            const airportNotams = notamData
                .filter(notam => notam.apt === airport.ICAO)
                .sort(compareNotamNumbers);

            return {
                ...airport,
                notams: airportNotams,
                latestNotam: airportNotams[0] || null
            };
        })
        .filter(airport => {
            return (
                !search ||
                String(airport.ICAO || "").toLowerCase().includes(search) ||
                String(airport.IATA || "").toLowerCase().includes(search) ||
                String(airport.name || "").toLowerCase().includes(search)
            );
        });

    $("#notamAirportTotal").text(airportsWithNotams.length);

    if (!airportsWithNotams.length) {
        $("#notamsContainer").html(`
            <div class="empty-state">
                <i class="bi bi-search me-2"></i>
                No airports with active NOTAMs found.
            </div>
        `);
        return;
    }

    const grouped = {};

    airportsWithNotams.forEach(airport => {
        const country = airport.state || "OTHER";

        if (!grouped[country]) {
            grouped[country] = [];
        }

        grouped[country].push(airport);
    });

    let html = "";

    Object.keys(grouped).sort().forEach(country => {
        const airports = grouped[country].sort((a, b) =>
            String(a.ICAO).localeCompare(String(b.ICAO))
        );

        let rows = "";

        airports.forEach(airport => {
            rows += renderOverviewRow(airport);
        });

        html += `
            <section class="country-section">
                <div class="country-heading">
                    <span class="country-code">
                        ${escapeNotamsHtml(country)}
                    </span>
                    ${escapeNotamsHtml(country)}
                </div>

                <div class="notams-list-card">
                    ${rows}
                </div>
            </section>
        `;
    });

    $("#notamsContainer").html(html);
}


/* =====================================================
   OVERVIEW ROW
===================================================== */

function renderOverviewRow(airport) {
    const notam = airport.latestNotam;

    // Airport without NOTAMs in database
    if (!notam) {
        return `
            <div class="notams-list-row">

                <div class="notams-airport-code">
                    <span class="notams-airport-link disabled">
                        ${escapeNotamsHtml(airport.ICAO)}
                    </span>

                    <span class="notams-iata">
                        ${escapeNotamsHtml(airport.IATA || "")}
                    </span>
                </div>

                <div class="notams-latest notams-no-notam">
                    <span>No NOTAMs in database</span>
                </div>

                <span class="notams-open-airport disabled"
                      title="No NOTAMs available">
                    <i class="bi bi-arrow-right-circle"></i>
                </span>

            </div>
        `;
    }

    // Airport with NOTAMs
    return `
        <div class="notams-list-row">

            <div class="notams-airport-code">
                <a href="airport-notams.html?icao=${encodeURIComponent(airport.ICAO)}"
                   class="notams-airport-link">
                    ${escapeNotamsHtml(airport.ICAO)}
                </a>

                <span class="notams-iata">
                    ${escapeNotamsHtml(airport.IATA || "")}
                </span>
            </div>

            <button type="button"
                    class="notam-open-button notams-latest"
                    data-number="${escapeNotamsHtml(notam.number)}"
                    data-plain-text="${escapeNotamsHtml(notam.plain_text || "")}">

                <div class="notams-latest-top">
                    <strong>${escapeNotamsHtml(notam.number)}</strong>

                    <span class="notams-latest-date">
                        ${formatNotamsDate(notam.issue_date)}
                    </span>
                </div>

                <div class="notams-latest-text">
                    ${highlightNotamsText(
        notam.short_text || "NOTAM text unavailable"
    )}
                </div>
            </button>

            <a href="airport-notams.html?icao=${encodeURIComponent(airport.ICAO)}"
               class="notams-open-airport"
               title="View all airport NOTAMs"
               aria-label="View all NOTAMs for ${escapeNotamsHtml(airport.ICAO)}">
                <i class="bi bi-arrow-right-circle"></i>
            </a>

        </div>
    `;
}


/* =====================================================
   AIRPORT DETAIL
===================================================== */

async function loadAirportNotams() {
    const params = new URLSearchParams(window.location.search);
    const icao = (params.get("icao") || "").trim().toUpperCase();

    if (!icao) {
        showAirportNotamsError("Missing airport ICAO code.");
        return;
    }

    try {
        const [airports, notams, check] = await Promise.all([
            supabaseClient
                .from("tbl_apt")
                .select("ICAO,IATA,name,state")
                .eq("ICAO", icao)
                .maybeSingle(),

            loadAllRows(
                "tbl_notams",
                "apt,number,classification,issue_date,start_date,end_date,short_text,plain_text",
                [
                    {
                        method: "eq",
                        column: "apt",
                        value: icao
                    }
                ]
            ),

            supabaseClient
                .from("tbl_check")
                .select("last_check_date")
                .eq("id", 1)
                .maybeSingle()
        ]);

        if (airports.error) throw airports.error;
        if (check.error) throw check.error;

        if (!airports.data) {
            showAirportNotamsError(`Airport ${icao} was not found in tbl_apt.`);
            return;
        }

        const airport = airports.data;

        const activeNotams = (notams || [])
            .filter(isNotamCurrentlyActive)
            .sort(compareNotamNumbers);

        $("#detailAirportTitle").text(
            `${airport.ICAO} - ${airport.name || ""}`
        );

        $("#detailAirportSubtitle").text(
            `${airport.IATA || ""} · ${airport.state || ""} · All active NOTAMs`
        );

        $("#detailNotamCount").text(activeNotams.length);

        updateNotamsLastCheck(check.data?.last_check_date);

        renderAirportNotamList(activeNotams);

    } catch (error) {
        console.error("Airport NOTAM detail error:", error);
        showAirportNotamsError(error.message);
    }
}


/* =====================================================
   AIRPORT DETAIL LIST
===================================================== */

function renderAirportNotamList(notams) {
    if (!notams.length) {
        $("#airportNotamsList").html(`
            <div class="empty-state">
                <i class="bi bi-check-circle me-2"></i>
                No active NOTAMs for this airport.
            </div>
        `);
        return;
    }

    let html = `
        <div class="notams-list-card airport-detail-notams">
    `;

    notams.forEach(notam => {
        html += `
            <button type="button"
                    class="notam-open-button airport-detail-notam"
                    data-number="${escapeNotamsHtml(notam.number)}"
                    data-plain-text="${escapeNotamsHtml(notam.plain_text || "")}">

                <div class="notams-detail-top">
                    <strong>${escapeNotamsHtml(notam.number)}</strong>

                    <span class="notam-classification">
                        ${escapeNotamsHtml(notam.classification || "N/A")}
                    </span>

                    <span class="notams-latest-date">
                        Issued: ${formatNotamsDate(notam.issue_date)}
                    </span>
                </div>

                <div class="notams-detail-text">
                    ${highlightNotamsText(
            notam.short_text || "NOTAM text unavailable"
        )}
                </div>

                <div class="notams-detail-dates">
                    <span>
                        <i class="bi bi-calendar-event me-1"></i>
                        Start: ${formatNotamsDate(notam.start_date)}
                    </span>

                    <span>
                        <i class="bi bi-calendar-check me-1"></i>
                        End: ${formatNotamsDate(notam.end_date)}
                    </span>
                </div>

                <div class="notam-open-hint">
                    <i class="bi bi-file-text me-1"></i>
                    Click to view ICAO text
                </div>
            </button>
        `;
    });

    html += "</div>";

    $("#airportNotamsList").html(html);
}


/* =====================================================
   TEXT HIGHLIGHTING
   Same criteria as Dashboard
===================================================== */

function highlightNotamsText(value) {
    let text = escapeNotamsHtml(value);

    const patterns = [
        {
            regex: /\b(CLSD|CLOSED|CLOSURE)\b/gi,
            css: "highlight-closure"
        },
        {
            regex: /\b(U\/S|UNSERVICEABLE|OUT OF SERVICE|NOT AVBL|NOT AVAILABLE|INOP|UNAVAILABLE)\b/gi,
            css: "highlight-unserviceable"
        },
        {
            regex: /\b(RWY|RUNWAY|RWYS|RUNWAYS)\b/gi,
            css: "highlight-runway"
        },
        {
            regex: /\b(TWY|TAXIWAY|TWYS|TAXIWAYS)\b/gi,
            css: "highlight-taxiway"
        },
        {
            regex: /\b(ILS|VOR|DME|NDB|TACAN|GBAS|GNSS|GPS|RADAR|SSR|LOCALIZER|LOCALISER)\b/gi,
            css: "highlight-navaid"
        },
        {
            regex: /\b(FUEL|FUELLING|FUELING|REFUELLING|REFUELING|JET A-?1|AVGAS)\b/gi,
            css: "highlight-fuel"
        }
    ];

    patterns.forEach(pattern => {
        text = text.replace(
            pattern.regex,
            match => `<span class="${pattern.css}">${match}</span>`
        );
    });

    return text;
}


/* =====================================================
   ICAO TEXT MODAL
===================================================== */

function showIcaoText(button) {
    currentPlainText = button.dataset.plainText || "";

    $("#icaoNotamNumber").text(
        button.dataset.number || ""
    );

    $("#icaoPlainText").text(
        currentPlainText || "ICAO text not available."
    );

    bootstrap.Modal.getOrCreateInstance(
        document.getElementById("icaoModal")
    ).show();
}

async function copyIcaoText() {
    if (!currentPlainText) {
        alert("No ICAO text available.");
        return;
    }

    try {
        await navigator.clipboard.writeText(currentPlainText);

        $("#copyIcaoText").html(
            '<i class="bi bi-check2 me-2"></i>Copied'
        );

        setTimeout(() => {
            $("#copyIcaoText").html(
                '<i class="bi bi-clipboard me-2"></i>Copy text'
            );
        }, 1500);

    } catch (error) {
        console.error("Clipboard error:", error);
        alert("Unable to copy text.");
    }
}


/* =====================================================
   LAST CHECK
===================================================== */

function updateNotamsLastCheck(date) {
    const icon = $("#checkStatusIcon");

    if (!date) {
        $("#lastCheck").text("Last check: Never");
        icon.attr("class", "bi bi-x-circle check-old");
        return;
    }

    const lastCheck = new Date(date);
    const today = new Date();

    const sameDay =
        lastCheck.getUTCFullYear() === today.getUTCFullYear() &&
        lastCheck.getUTCMonth() === today.getUTCMonth() &&
        lastCheck.getUTCDate() === today.getUTCDate();

    $("#lastCheck").text(
        "Last check: " +
        lastCheck.toLocaleString("en-GB", {
            timeZone: "UTC",
            dateStyle: "short",
            timeStyle: "short"
        }) +
        " UTC"
    );

    icon.attr(
        "class",
        sameDay
            ? "bi bi-check-circle check-ok"
            : "bi bi-x-circle check-old"
    );
}


/* =====================================================
   HELPERS
===================================================== */

function formatNotamsDate(value) {
    if (!value) return "N/A";

    if (String(value).toUpperCase() === "PERM") {
        return "PERMANENT";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return escapeNotamsHtml(value);
    }

    return date.toLocaleString("en-GB", {
        timeZone: "UTC",
        dateStyle: "short",
        timeStyle: "short"
    }) + " UTC";
}

function escapeNotamsHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function showAirportNotamsError(message) {
    $("#airportNotamsList").html(`
        <div class="alert alert-danger">
            ${escapeNotamsHtml(message)}
        </div>
    `);
}
