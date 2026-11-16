
const SUPABASE_URL = "https://yjhtjgqajtiqsyezdcfp.supabase.co";
const SUPABASE_KEY = "sb_publishable_h2QLk6TMCDnVRP_WEAznNw_EtmCB-1D";
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/check-notams`;

const DAYS_AHEAD = 7;

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let currentPlainText = "";

$(document).ready(function () {
    initializeTheme();
    loadDashboard();

    $("#checkNotamsBtn").on("click", checkNotams);
    $("#categoryFilter").on("change", loadDashboard);
    $("#themeToggle").on("click", toggleTheme);
    $("#copyIcaoText").on("click", copyIcaoText);

    $("#airportsContainer").on("click", ".notam-item", function () {
        showIcaoText(this);
    });
});

/* ==========================================
   THEME
========================================== */

function initializeTheme() {
    const theme = localStorage.getItem("en_notam_theme") || "dark";
    $("html").attr("data-theme", theme);
    updateThemeButton(theme);
}

function toggleTheme() {
    const current = $("html").attr("data-theme");
    const next = current === "dark" ? "light" : "dark";

    $("html").attr("data-theme", next);
    localStorage.setItem("en_notam_theme", next);
    updateThemeButton(next);
}

function updateThemeButton(theme) {
    $("#themeToggle").html(
        theme === "dark"
            ? '<i class="bi bi-sun-fill"></i>'
            : '<i class="bi bi-moon-fill"></i>'
    );
}

/* ==========================================
   LOAD DASHBOARD
========================================== */

async function loadDashboard() {
    $("#airportsContainer").html(`
        <div class="loading-state">
            <span class="spinner-border spinner-border-sm me-2"></span>
            Loading dashboard...
        </div>
    `);

    try {
        const [
            { data: airports, error: airportError },
            { data: notams, error: notamError },
            { data: check, error: checkError }
        ] = await Promise.all([
            supabaseClient
                .from("tbl_apt")
                .select("ICAO,IATA,name,state")
                .order("state")
                .order("ICAO"),

            supabaseClient
                .from("tbl_notams")
                .select("*")
                .eq("classification", "INTL")
                .order("apt")
                .order("number"),

            supabaseClient
                .from("tbl_check")
                .select("last_check_date")
                .eq("id", 1)
                .maybeSingle()
        ]);

        if (airportError) throw airportError;
        if (notamError) throw notamError;
        if (checkError) throw checkError;

        const validNotams = (notams || [])
            .filter(isNotamActiveOrUpcoming);

        const airportsWithNotams = (airports || []).map(airport => {
            const airportNotams = validNotams.filter(
                n => n.apt === airport.ICAO
            );

            return {
                ...airport,
                notams: airportNotams,
                operationalNotams: airportNotams
                    .map(n => ({
                        ...n,
                        category: categorizeNotam(n)
                    }))
                    .filter(n => n.category !== null),
                airportClosed: isAirportClosed(airportNotams)
            };
        });

        renderDashboard(airportsWithNotams);
        updateLastCheck(check?.last_check_date);

    } catch (error) {
        console.error("Dashboard error:", error);

        $("#airportsContainer").html(`
            <div class="alert alert-danger">
                Unable to load Supabase data:
                ${escapeHtml(error.message)}
            </div>
        `);
    }
}

/* ==========================================
   VALIDITY
========================================== */

function isNotamActiveOrUpcoming(notam) {
    const now = new Date();

    const limit = new Date(
        now.getTime() + DAYS_AHEAD * 86400000
    );

    if (!notam.start_date) return false;

    const start = new Date(notam.start_date);

    if (Number.isNaN(start.getTime()) || start > limit) {
        return false;
    }

    if (String(notam.end_date || "").toUpperCase() === "PERM") {
        return true;
    }

    if (!notam.end_date) return false;

    const end = new Date(notam.end_date);

    return !Number.isNaN(end.getTime()) && end >= now;
}

/* ==========================================
   TEXT HELPERS
========================================== */

function getNotamText(notam) {
    return `
        ${notam.short_text || ""}
        ${notam.plain_text || ""}
    `.toUpperCase();
}

function matches(text, regex) {
    return regex.test(text);
}

/* ==========================================
   CLOSURE DETECTION
========================================== */

function isAllRunwaysClosed(notams) {
    return notams.some(notam => {
        const text = getNotamText(notam);

        return matches(
            text,
            /\b(ALL\s+(RUNWAYS|RWY)|ALL\s+RWYS)\b.{0,100}\b(CLSD|CLOSED|U\/S|UNSERVICEABLE)\b|\b(CLSD|CLOSED|U\/S|UNSERVICEABLE)\b.{0,100}\b(ALL\s+(RUNWAYS|RWY|RWYS))\b/
        );
    });
}

function isAllTaxiwaysClosed(notams) {
    return notams.some(notam => {
        const text = getNotamText(notam);

        return matches(
            text,
            /\b(ALL\s+(TAXIWAYS|TWY|TWYS)|TAXIWAYS\s+ALL)\b.{0,100}\b(CLSD|CLOSED|U\/S|UNSERVICEABLE)\b|\b(CLSD|CLOSED|U\/S|UNSERVICEABLE)\b.{0,100}\b(ALL\s+(TAXIWAYS|TWY|TWYS))\b/
        );
    });
}

function isAirportClosed(notams) {
    return (
        isAllRunwaysClosed(notams) &&
        isAllTaxiwaysClosed(notams)
    );
}

/* ==========================================
   OPERATIONAL CLASSIFICATION
========================================== */

function categorizeNotam(notam) {
    const text = getNotamText(notam);

    const closureTerms =
        /\b(CLSD|CLOSED|CLOSURE|U\/S|UNSERVICEABLE|OUT OF SERVICE|NOT AVBL|NOT AVAILABLE|INOP|UNAVAILABLE|SUSPENDED)\b/;

    // Fuel / refuelling
    if (
        /\b(FUEL|FUELLING|FUELING|REFUELLING|REFUELING|AVGAS|JET A-?1|FUEL SUPPLY)\b/.test(text)
    ) {
        return "fuel";
    }

    // Navaids: only actual unserviceability or closure
    const hasNavaid =
        /\b(ILS|LOCALIZER|LOCALISER|GLIDE PATH|GLIDESLOPE|VOR|DME|NDB|TACAN|GBAS|GNSS)\b/.test(text);

    if (hasNavaid && closureTerms.test(text)) {
        return "navaid";
    }

    // All taxiways closed: individual taxiway closures are ignored
    if (isAllTaxiwaysClosed([notam])) {
        return "taxiway";
    }

    // Runway: show only actual runway closure / unserviceability
    const hasRunway = /\b(RWY|RUNWAY|RWYS|RUNWAYS)\b/.test(text);

    if (hasRunway && closureTerms.test(text)) {
        return "runway";
    }

    // Other airport operational problems, excluding individual taxiways
    const hasAirportIssue =
        /\b(AD CLSD|AERODROME CLSD|AIRPORT CLOSED|AERODROME CLOSED|APRON|STAND|PARKING AREA|MOVEMENT AREA|AIRCRAFT STAND|AIRPORT LIGHTING)\b/.test(text);

    if (hasAirportIssue) {
        return "airport";
    }

    return null;
}

/* ==========================================
   CATEGORY DETAILS
========================================== */

function categoryInfo(category) {
    const categories = {
        runway: {
            label: "RUNWAY CLOSURE",
            icon: "bi-cone-striped",
            color: "runway"
        },
        taxiway: {
            label: "ALL TAXIWAYS CLOSED",
            icon: "bi-sign-stop",
            color: "runway"
        },
        airport: {
            label: "AERODROME",
            icon: "bi-airplane",
            color: "airport"
        },
        fuel: {
            label: "FUEL",
            icon: "bi-fuel-pump",
            color: "fuel"
        },
        navaid: {
            label: "NAVAIDS",
            icon: "bi-broadcast",
            color: "navaid"
        }
    };

    return categories[category];
}

/* ==========================================
   FILTER
========================================== */

function applyCategoryFilter(notams) {
    const filter = $("#categoryFilter").val() || "all";

    if (filter === "all") return notams;

    return notams.filter(n => n.category === filter);
}

/* ==========================================
   RENDER DASHBOARD
========================================== */

function renderDashboard(airports) {
    const visibleAirports = airports
        .map(airport => ({
            ...airport,
            visibleNotams: applyCategoryFilter(
                airport.operationalNotams
            )
        }))
        .filter(airport => airport.visibleNotams.length > 0);

    const visibleNotamCount = visibleAirports.reduce(
        (total, airport) => total + airport.visibleNotams.length,
        0
    );

    const countries = [
        ...new Set(visibleAirports.map(a => a.state || "OTHER"))
    ];

    $("#airportCount").text(visibleAirports.length);
    $("#notamCount").text(visibleNotamCount);
    $("#countryCount").text(countries.length);

    if (!visibleAirports.length) {
        $("#airportsContainer").html(`
            <div class="empty-state">
                <i class="bi bi-check-circle me-2"></i>
                No relevant active or upcoming NOTAMs.
            </div>
        `);
        return;
    }

    const grouped = {};

    visibleAirports.forEach(airport => {
        const country = airport.state || "OTHER";

        if (!grouped[country]) {
            grouped[country] = [];
        }

        grouped[country].push(airport);
    });

    let html = "";

    Object.keys(grouped).sort().forEach(country => {
        let cards = "";

        grouped[country].forEach(airport => {
            cards += renderAirportCard(airport);
        });

        html += `
            <section class="country-section">
                <div class="country-heading">
                    <span class="country-code">
                        ${escapeHtml(country)}
                    </span>
                    ${escapeHtml(country)}
                </div>

                <div class="row g-3">
                    ${cards}
                </div>
            </section>
        `;
    });

    $("#airportsContainer").html(html);
}

/* ==========================================
   AIRPORT CARD
========================================== */

function renderAirportCard(airport) {
    const notams = airport.visibleNotams;

    const airportClosed = airport.airportClosed;

    let notamHtml = "";

    notams.forEach(notam => {
        notamHtml += renderNotam(notam);
    });

    return `
        <div class="col-xl-6 col-lg-6 col-md-12">
            <div class="airport-card">

                <div class="airport-header d-flex justify-content-between align-items-center">
                    <div>
                        <div class="airport-icao">
                            ${escapeHtml(airport.ICAO)}
                        </div>

                        <div class="airport-name">
                            ${escapeHtml(airport.name || "")}
                        </div>
                    </div>

                    <div class="airport-header-right">
                        <span class="airport-iata">
                            ${escapeHtml(airport.IATA || "")}
                        </span>

                        ${
                            airportClosed
                                ? '<span class="airport-closed-badge"><i class="bi bi-exclamation-octagon-fill me-1"></i>AIRPORT CLOSED</span>'
                                : ""
                        }
                    </div>
                </div>

                <div class="airport-body">

                    <div class="d-flex justify-content-between mb-3">
                        <small class="text-secondary">
                            Relevant NOTAMs
                        </small>

                        <span class="badge text-bg-primary">
                            ${notams.length}
                        </span>
                    </div>

                    <div class="airport-notams-scroll">
                        ${notamHtml}
                    </div>

                </div>
            </div>
        </div>
    `;
}

/* ==========================================
   NOTAM CARD
========================================== */

function renderNotam(notam) {
    const info = categoryInfo(notam.category);

    return `
        <button
            type="button"
            class="notam-item ${info.color}"
            data-plain-text="${escapeHtml(notam.plain_text || "")}"
            data-number="${escapeHtml(notam.number)}"
            aria-label="Open NOTAM ${escapeHtml(notam.number)}"
        >
            <div class="notam-topline">

                <span class="notam-category-icon">
                    <i class="bi ${info.icon}"></i>
                </span>

                <span class="notam-number">
                    ${escapeHtml(notam.number)}
                </span>

                <span class="notam-category-label">
                    ${info.label}
                </span>

                <i class="bi bi-chevron-right notam-chevron"></i>

            </div>

            <div class="notam-short-text">
                ${highlightOperationalText(notam.short_text || "NOTAM text unavailable")}
            </div>

            <div class="notam-dates">
                <span>
                    <i class="bi bi-calendar-event me-1"></i>
                    Start: ${formatDate(notam.start_date)}
                </span>

                <span>
                    <i class="bi bi-calendar-check me-1"></i>
                    End: ${formatDate(notam.end_date)}
                </span>
            </div>

            <div class="notam-open-hint">
                <i class="bi bi-file-text me-1"></i>
                Click to view ICAO text
            </div>
        </button>
    `;
}

/* ==========================================
   OPERATIONAL TEXT HIGHLIGHTING
========================================== */

function highlightOperationalText(value) {
    let text = escapeHtml(value);

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
            regex: /\b(ILS|VOR|DME|NDB|TACAN|GBAS|GNSS|LOCALIZER|LOCALISER)\b/gi,
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

/* ==========================================
   ICAO MODAL
========================================== */

function showIcaoText(button) {
    currentPlainText = button.dataset.plainText || "";

    $("#icaoNotamNumber").text(button.dataset.number || "");

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

/* ==========================================
   CHECK NOTAMS
========================================== */

async function checkNotams() {
    const button = $("#checkNotamsBtn");

    if (button.prop("disabled")) return;

    button.prop("disabled", true).html(`
        <span class="spinner-border spinner-border-sm me-2"></span>
        CHECKING...
    `);

    $("#checkResult").empty();

    try {
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "apikey": SUPABASE_KEY
            },
            body: JSON.stringify({})
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.error ||
                result.failures?.map(item =>
                    `${item.icao}: ${item.error}`
                ).join("; ") ||
                "NOTAM check failed"
            );
        }

        await loadDashboard();

        $("#checkResult").html(`
            <div class="alert alert-success">
                <strong>NOTAM check completed.</strong>

                <div class="check-details mt-2">
                    Airports checked: ${result.airports_checked}<br>
                    Airports successful: ${result.airports_succeeded}<br>
                    Airports failed: ${result.airports_failed}<br>
                    NOTAMs received: ${result.total_received}<br>
                    INTL NOTAMs received: ${result.total_intl_received}<br>
                    Records inserted / updated: ${result.total_upserted}<br>
                    Expired NOTAMs deleted: ${result.expired_deleted}<br>
                    Completed: ${formatDate(result.check_completed_at)}
                </div>
            </div>
        `);

    } catch (error) {
        console.error("Check NOTAMs error:", error);

        $("#checkResult").html(`
            <div class="alert alert-danger">
                <strong>Check failed:</strong>
                ${escapeHtml(error.message)}
            </div>
        `);

        await loadDashboard();

    } finally {
        button.prop("disabled", false).html(`
            <i class="bi bi-arrow-repeat me-2"></i>
            CHECK NOTAMS
        `);
    }
}

/* ==========================================
   LAST CHECK
========================================== */

function updateLastCheck(date) {
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

/* ==========================================
   HELPERS
========================================== */

function formatDate(value) {
    if (!value) return "N/A";

    if (String(value).toUpperCase() === "PERM") {
        return "PERMANENT";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("en-GB", {
        timeZone: "UTC",
        dateStyle: "short",
        timeStyle: "short"
    }) + " UTC";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}
