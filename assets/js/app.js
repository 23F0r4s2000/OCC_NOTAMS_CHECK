
/* ==========================================
   CONFIGURATION
========================================== */

const SUPABASE_URL = "https://yjhtjgqajtiqsyezdcfp.supabase.co";
const SUPABASE_KEY = "INCOLLA_QUI_LA_TUA_PUBLISHABLE_KEY";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const EDGE_FUNCTION_URL =
    `${SUPABASE_URL}/functions/v1/check-notams`;

let currentPlainText = "";


/* ==========================================
   INITIALIZATION
========================================== */

$(document).ready(function () {

    initializeTheme();

    loadDashboard();

    $("#checkNotamsBtn").on("click", checkNotams);

    $("#categoryFilter").on("change", loadDashboard);

    $("#themeToggle").on("click", toggleTheme);

    $("#copyIcaoText").on("click", copyIcaoText);

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

    $("#airportsContainer").html(
        '<div class="loading-state">' +
        '<span class="spinner-border spinner-border-sm me-2"></span>' +
        'Loading dashboard...</div>'
    );

    try {

        const [
            { data: airports, error: airportError },
            { data: notams, error: notamError },
            { data: checks, error: checkError }
        ] = await Promise.all([

            supabaseClient
                .from("tbl_apt")
                .select("*")
                .order("state")
                .order("ICAO"),

            supabaseClient
                .from("tbl_notams")
                .select("*")
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

        const activeNotams = (notams || []).filter(isNotamActive);

        renderDashboard(airports || [], activeNotams);

        updateLastCheck(checks?.last_check_date);

    } catch (error) {

        console.error(error);

        $("#airportsContainer").html(
            '<div class="alert alert-danger">' +
            'Unable to load Supabase data: ' +
            escapeHtml(error.message) +
            '</div>'
        );
    }
}


/* ==========================================
   ACTIVE NOTAM FILTER
========================================== */

function isNotamActive(notam) {

    const now = new Date();

    const start = new Date(notam.start_date);

    if (Number.isNaN(start.getTime())) {
        return false;
    }

    const isPermanent = notam.end_date === "PERM";

    const end = isPermanent
        ? null
        : new Date(notam.end_date);

    const notExpired = isPermanent ||
        (!Number.isNaN(end?.getTime()) && end >= now);

    return start <= now && notExpired;
}


/* ==========================================
   RENDER DASHBOARD
========================================== */

function renderDashboard(airports, notams) {

    $("#airportCount").text(airports.length);
    $("#notamCount").text(notams.length);

    const countries = [...new Set(
        airports.map(airport => airport.state)
    )];

    $("#countryCount").text(countries.length);

    const filter = $("#categoryFilter").val() || "all";

    const grouped = {};

    airports.forEach(airport => {

        const country = airport.state || "OTHER";

        if (!grouped[country]) {
            grouped[country] = [];
        }

        grouped[country].push(airport);
    });

    let html = "";

    Object.keys(grouped).sort().forEach(country => {

        let airportCards = "";

        grouped[country].forEach(airport => {

            const airportNotams = notams.filter(notam =>
                notam.apt === airport.ICAO &&
                (filter === "all" ||
                    notam.classification === filter)
            );

            airportCards += renderAirportCard(
                airport,
                airportNotams
            );
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
                    ${airportCards}
                </div>
            </section>
        `;
    });

    $("#airportsContainer").html(
        html || '<div class="empty-state">No airports configured.</div>'
    );
}


/* ==========================================
   AIRPORT CARD
========================================== */

function renderAirportCard(airport, notams) {

    let notamHtml = "";

    if (notams.length === 0) {

        notamHtml = `
            <div class="no-notams">
                <i class="bi bi-check-circle me-1"></i>
                No active or upcoming NOTAMs
            </div>
        `;

    } else {

        notams.forEach(notam => {

            const id = `notam-${Math.random().toString(36).slice(2)}`;

            // Store the plain text in a data attribute.
            const plainText = escapeHtml(notam.plain_text || "");

            notamHtml += `
                <div class="notam-item">

                    <div class="d-flex justify-content-between align-items-center gap-2">
                        <span class="notam-number">
                            ${escapeHtml(notam.number)}
                        </span>

                        <span class="notam-classification">
                            ${escapeHtml(notam.classification || "N/A")}
                        </span>
                    </div>

                    <div class="notam-short-text">
                        ${escapeHtml(notam.short_text || "")}
                    </div>

                    <div class="notam-dates">
                        <div>
                            <i class="bi bi-calendar-event me-1"></i>
                            Start: ${formatDate(notam.start_date)}
                        </div>

                        <div>
                            <i class="bi bi-calendar-x me-1"></i>
                            End: ${escapeHtml(notam.end_date || "N/A")}
                        </div>
                    </div>

                    <div class="mt-3">
                        <button
                            class="btn btn-outline-primary btn-icao"
                            data-number="${escapeHtml(notam.number)}"
                            data-plain-text="${plainText}"
                            onclick="showIcaoText(this)"
                        >
                            <i class="bi bi-file-text me-1"></i>
                            ICAO TEXT
                        </button>
                    </div>

                </div>
            `;
        });
    }

    return `
        <div class="col-xl-4 col-lg-6 col-md-6">
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

                    <div class="airport-iata">
                        ${escapeHtml(airport.IATA || "")}
                    </div>

                </div>

                <div class="airport-body">

                    <div class="d-flex justify-content-between mb-3">
                        <small class="text-secondary">
                            NOTAMs
                        </small>

                        <span class="badge text-bg-primary">
                            ${notams.length}
                        </span>
                    </div>

                    ${notamHtml}

                </div>

            </div>
        </div>
    `;
}


/* ==========================================
   ICAO TEXT MODAL
========================================== */

function showIcaoText(button) {

    currentPlainText = button.dataset.plainText || "";

    const number = button.dataset.number || "";

    $("#icaoNotamNumber").text(number);

    $("#icaoPlainText").text(
        currentPlainText || "ICAO text not available."
    );

    const modal = bootstrap.Modal.getOrCreateInstance(
        document.getElementById("icaoModal")
    );

    modal.show();
}

async function copyIcaoText() {

    if (!currentPlainText) {
        alert("No ICAO text available.");
        return;
    }

    try {

        await navigator.clipboard.writeText(currentPlainText);

        $("#copyIcaoText")
            .html('<i class="bi bi-check2 me-2"></i>Copied');

        setTimeout(() => {
            $("#copyIcaoText").html(
                '<i class="bi bi-clipboard me-2"></i>Copy text'
            );
        }, 1500);

    } catch (error) {

        console.error(error);

        alert("Unable to copy text. Check browser permissions.");
    }
}


/* ==========================================
   CHECK NOTAMS
========================================== */

async function checkNotams() {

    const button = $("#checkNotamsBtn");

    if (button.prop("disabled")) return;

    button.prop("disabled", true);

    button.html(
        '<span class="spinner-border spinner-border-sm me-2"></span>' +
        'CHECKING...'
    );

    $("#checkResult").empty();

    $("#checkProgress").removeClass("d-none");

    try {

        const { data: sessionData } =
            await supabaseClient.auth.getSession();

        const accessToken = sessionData?.session?.access_token;

        // La funzione usa il JWT dell'utente autenticato.
        // Per l'uso aziendale, configura l'autenticazione e le policy
        // in base agli utenti autorizzati.

        if (!accessToken) {
            throw new Error(
                "You must authenticate before starting a NOTAM check."
            );
        }

        const response = await fetch(EDGE_FUNCTION_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
                "apikey": SUPABASE_KEY,
            },
            body: JSON.stringify({}),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || "NOTAM check failed");
        }

        $("#checkResult").html(`
            <div class="alert alert-success">
                <strong>NOTAM check completed.</strong>
                <div class="mt-2">
                    Airports checked: ${result.airports_checked}<br>
                    NOTAMs received: ${result.total_received}<br>
                    Relevant NOTAMs: ${result.total_relevant}<br>
                    Records inserted/updated: ${result.total_upserted}
                </div>
            </div>
        `);

        await loadDashboard();

    } catch (error) {

        console.error(error);

        $("#checkResult").html(`
            <div class="alert alert-danger">
                <strong>Check failed:</strong>
                ${escapeHtml(error.message)}
            </div>
        `);

    } finally {

        $("#checkProgress").addClass("d-none");

        button.prop("disabled", false);

        button.html(
            '<i class="bi bi-arrow-repeat me-2"></i>CHECK NOTAMS'
        );
    }
}


/* ==========================================
   LAST CHECK
========================================== */

function updateLastCheck(date) {

    const icon = $("#checkStatusIcon");

    if (!date) {

        $("#lastCheck").text("Last check: Never");

        icon.removeClass("check-ok").addClass("check-old");

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

    if (value === "PERM") return "PERMANENT";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return value;

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
