
const SUPABASE_URL = "https://yjhtjgqajtiqsyezdcfp.supabase.co";
const SUPABASE_KEY = "sb_publishable_h2QLk6TMCDnVRP_WEAznNw_EtmCB-1D";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

let airportRecords = [];
let airportToDelete = null;

$(document).ready(function () {
    initializeAirportsTheme();

    loadAirports();
    loadAirportsLastCheck();

    $("#airportManagementSearch").on("input", renderAirportList);

    $("#openAddAirport").on("click", function () {
        $("#addAirportForm")[0].reset();
        $("#addAirportError").hide();

        bootstrap.Modal.getOrCreateInstance(
            document.getElementById("addAirportModal")
        ).show();
    });

    $("#addAirportForm").on("submit", addAirport);

    $("#airportList").on("click", ".delete-airport-btn", function () {
        airportToDelete = $(this).data("icao");

        const airport = airportRecords.find(
            a => a.ICAO === airportToDelete
        );

        if (!airport) return;

        $("#deleteAirportLabel").text(
            `${airport.ICAO} - ${airport.IATA} - ${airport.name}`
        );

        bootstrap.Modal.getOrCreateInstance(
            document.getElementById("deleteAirportModal")
        ).show();
    });

    $("#confirmDeleteAirport").on("click", deleteAirport);

    $("#themeToggle").on("click", toggleAirportsTheme);
});

/* ==========================================
   THEME
========================================== */

function initializeAirportsTheme() {
    const theme = localStorage.getItem("en_notam_theme") || "dark";

    $("html").attr("data-theme", theme);
    updateAirportsThemeButton(theme);
}

function toggleAirportsTheme() {
    const current = $("html").attr("data-theme");
    const next = current === "dark" ? "light" : "dark";

    $("html").attr("data-theme", next);
    localStorage.setItem("en_notam_theme", next);

    updateAirportsThemeButton(next);
}

function updateAirportsThemeButton(theme) {
    $("#themeToggle").html(
        theme === "dark"
            ? '<i class="bi bi-sun-fill"></i>'
            : '<i class="bi bi-moon-fill"></i>'
    );
}

/* ==========================================
   LOAD AIRPORTS
========================================== */

async function loadAirports() {
    $("#airportList").html(`
        <div class="airport-list-loading">
            <span class="spinner-border spinner-border-sm me-2"></span>
            Loading airports...
        </div>
    `);

    try {
        const { data, error } = await supabaseClient
            .from("tbl_apt")
            .select("ICAO,IATA,name,state")
            .order("ICAO", { ascending: true });

        if (error) throw error;

        airportRecords = data || [];

        $("#airportTotal").text(airportRecords.length);

        renderAirportList();

    } catch (error) {
        console.error("Load airports error:", error);

        $("#airportList").empty();

        showAirportMessage(
            `Unable to load airports: ${error.message}`,
            "danger"
        );
    }
}

/* ==========================================
   RENDER AIRPORT LIST
========================================== */

function renderAirportList() {
    const search = (
        $("#airportManagementSearch").val() || ""
    ).trim().toUpperCase();

    const filtered = airportRecords.filter(airport => {
        return (
            (airport.ICAO || "").toUpperCase().includes(search) ||
            (airport.IATA || "").toUpperCase().includes(search) ||
            (airport.name || "").toUpperCase().includes(search) ||
            (airport.state || "").toUpperCase().includes(search)
        );
    });

    if (!filtered.length) {
        $("#airportList").empty();
        $("#airportEmpty").show();
        return;
    }

    $("#airportEmpty").hide();

    let html = "";

    filtered.forEach(airport => {
        html += `
            <div class="airport-list-row">

                <div class="airport-list-icao">
                    ${escapeAirportHtml(airport.ICAO)}
                </div>

                <div class="airport-list-iata">
                    ${escapeAirportHtml(airport.IATA)}
                </div>

                <div class="airport-list-name">
                    <strong>${escapeAirportHtml(airport.name)}</strong>
                    <small>${escapeAirportHtml(airport.state)}</small>
                </div>

                <div class="airport-list-state">
                    ${escapeAirportHtml(airport.state)}
                </div>

                <div class="airport-list-actions">
                    <button type="button"
                            class="btn btn-sm btn-outline-danger delete-airport-btn"
                            data-icao="${escapeAirportHtml(airport.ICAO)}"
                            title="Delete airport">
                        <i class="bi bi-trash"></i>
                        <span>Delete</span>
                    </button>
                </div>

            </div>
        `;
    });

    $("#airportList").html(html);
}

/* ==========================================
   ADD AIRPORT
========================================== */

async function addAirport(event) {
    event.preventDefault();

    const button = $("#saveAirportBtn");

    const airport = {
        ICAO: $("#newAirportICAO").val().trim().toUpperCase(),
        IATA: $("#newAirportIATA").val().trim().toUpperCase(),
        state: $("#newAirportState").val().trim().toUpperCase(),
        name: $("#newAirportName").val().trim().toUpperCase()
    };

    $("#addAirportError").hide();

    if (!/^[A-Z0-9]{4}$/.test(airport.ICAO)) {
        showAddAirportError("ICAO must contain exactly 4 characters.");
        return;
    }

    if (!/^[A-Z0-9]{3}$/.test(airport.IATA)) {
        showAddAirportError("IATA must contain exactly 3 characters.");
        return;
    }

    if (!airport.state || !airport.name) {
        showAddAirportError("All fields are required.");
        return;
    }

    button.prop("disabled", true).html(`
        <span class="spinner-border spinner-border-sm me-2"></span>
        Saving...
    `);

    try {
        const { error } = await supabaseClient
            .from("tbl_apt")
            .insert([airport]);

        if (error) throw error;

        bootstrap.Modal.getOrCreateInstance(
            document.getElementById("addAirportModal")
        ).hide();

        showAirportMessage(
            `${airport.ICAO} successfully added.`,
            "success"
        );

        await loadAirports();

    } catch (error) {
        console.error("Add airport error:", error);
        showAddAirportError(error.message);

    } finally {
        button.prop("disabled", false).html(`
            <i class="bi bi-plus-lg me-2"></i>
            Save airport
        `);
    }
}

function showAddAirportError(message) {
    $("#addAirportError")
        .text(message)
        .show();
}

/* ==========================================
   DELETE AIRPORT AND ASSOCIATED NOTAMS
========================================== */

async function deleteAirport() {
    if (!airportToDelete) return;

    const button = $("#confirmDeleteAirport");

    button.prop("disabled", true).html(`
        <span class="spinner-border spinner-border-sm me-2"></span>
        Deleting...
    `);

    try {
        // 1. Delete all NOTAMs associated with the airport.
        const { error: notamError } = await supabaseClient
            .from("tbl_notams")
            .delete()
            .eq("apt", airportToDelete);

        if (notamError) {
            throw new Error(
                `Unable to delete airport NOTAMs: ${notamError.message}`
            );
        }

        // 2. Delete the airport.
        const { error: airportError } = await supabaseClient
            .from("tbl_apt")
            .delete()
            .eq("ICAO", airportToDelete);

        if (airportError) {
            throw new Error(
                `NOTAMs deleted, but airport deletion failed: ${airportError.message}`
            );
        }

        bootstrap.Modal.getOrCreateInstance(
            document.getElementById("deleteAirportModal")
        ).hide();

        showAirportMessage(
            `${airportToDelete} and its associated NOTAMs have been deleted.`,
            "success"
        );

        airportToDelete = null;

        await loadAirports();

    } catch (error) {
        console.error("Delete airport error:", error);

        showAirportMessage(error.message, "danger");

    } finally {
        button.prop("disabled", false).html(`
            <i class="bi bi-trash me-2"></i>
            Delete airport
        `);
    }
}

/* ==========================================
   LAST CHECK
========================================== */

async function loadAirportsLastCheck() {
    try {
        const { data, error } = await supabaseClient
            .from("tbl_check")
            .select("last_check_date")
            .eq("id", 1)
            .maybeSingle();

        if (error) throw error;

        const date = data?.last_check_date;

        if (!date) {
            $("#lastCheck").text("Last check: Never");
            $("#checkStatusIcon").attr(
                "class",
                "bi bi-x-circle check-old"
            );
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

        $("#checkStatusIcon").attr(
            "class",
            sameDay
                ? "bi bi-check-circle check-ok"
                : "bi bi-x-circle check-old"
        );

    } catch (error) {
        console.error("Last check error:", error);
        $("#lastCheck").text("Last check: Unavailable");
    }
}

/* ==========================================
   MESSAGES AND HELPERS
========================================== */

function showAirportMessage(message, type) {
    $("#airportPageMessage").html(`
        <div class="alert alert-${type} alert-dismissible fade show">
            ${escapeAirportHtml(message)}
            <button type="button"
                    class="btn-close"
                    data-bs-dismiss="alert"></button>
        </div>
    `);
}

function escapeAirportHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}
