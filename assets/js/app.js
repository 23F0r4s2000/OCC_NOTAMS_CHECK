
$(document).ready(function () {

    /* ========================================
       THEME MANAGEMENT
    ======================================== */

    function applyTheme(theme) {

        $("html").attr("data-theme", theme);

        if (theme === "dark") {

            $("#themeIcon")
                .removeClass("bi-moon-stars-fill")
                .addClass("bi-sun-fill");

            $("#themeLabel").text("Light mode");

        } else {

            $("#themeIcon")
                .removeClass("bi-sun-fill")
                .addClass("bi-moon-stars-fill");

            $("#themeLabel").text("Dark mode");

        }

        localStorage.setItem("en_notam_theme", theme);
    }


    // Load saved theme
    const savedTheme = localStorage.getItem("en_notam_theme") || "light";

    applyTheme(savedTheme);


    // Toggle theme
    $("#themeToggle").on("click", function () {

        const currentTheme = $("html").attr("data-theme");

        const newTheme = currentTheme === "light" ? "dark" : "light";

        applyTheme(newTheme);

    });


    /* ========================================
       CURRENT DATE
    ======================================== */

    function updateCurrentDate() {

        const now = new Date();

        const formattedDate = new Intl.DateTimeFormat("en-GB", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }).format(now);

        $("#currentDate").text(formattedDate);

    }

    updateCurrentDate();


    /* ========================================
       LAST CHECK STATUS
    ======================================== */

    function updateLastCheck(dateString) {

        const lastCheck = new Date(dateString);

        if (isNaN(lastCheck.getTime())) {
            return;
        }

        const now = new Date();

        const isToday =
            lastCheck.getUTCFullYear() === now.getUTCFullYear() &&
            lastCheck.getUTCMonth() === now.getUTCMonth() &&
            lastCheck.getUTCDate() === now.getUTCDate();

        const formattedDate = new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC"
        }).format(lastCheck);

        $("#lastCheckDate").text(formattedDate + " UTC");

        if (isToday) {

            $("#lastCheckStatus")
                .removeClass("status-error")
                .addClass("status-ok");

            $("#lastCheckIcon")
                .removeClass("bi-x-circle-fill")
                .addClass("bi-check-circle-fill");

        } else {

            $("#lastCheckStatus")
                .removeClass("status-ok")
                .addClass("status-error");

            $("#lastCheckIcon")
                .removeClass("bi-check-circle-fill")
                .addClass("bi-x-circle-fill");

        }

    }


    // DEMO DATA: replace with database value later
    updateLastCheck("2026-11-16T08:35:00Z");


    /* ========================================
       NOTAM CATEGORY FILTER
    ======================================== */

    $("#notamFilter").on("change", function () {

        const selectedCategory = $(this).val();

        $(".country-section").each(function () {

            const countrySection = $(this);
            let visibleAirports = 0;

            countrySection.find(".airport-column").each(function () {

                const airport = $(this);

                if (selectedCategory === "all") {

                    airport.show();
                    visibleAirports++;

                } else {

                    const matchingNotams = airport.find(
                        '.notam-item[data-category="' + selectedCategory + '"]'
                    );

                    if (matchingNotams.length > 0) {

                        airport.show();
                        airport.find(".notam-item").hide();
                        matchingNotams.show();

                        visibleAirports++;

                    } else {

                        airport.hide();

                    }

                }

            });

            // Show country only if it has visible airports
            if (visibleAirports > 0) {

                countrySection.show();

            } else {

                countrySection.hide();

            }

            // Restore all NOTAMs when no filter is selected
            if (selectedCategory === "all") {

                countrySection.find(".notam-item").show();

            }

        });

    });


    /* ========================================
       START CHECK - DEMO
    ======================================== */

    $("#startCheckBtn").on("click", function () {

        const button = $(this);

        button.prop("disabled", true);

        button.html(
            '<span class="spinner-border spinner-border-sm me-2"></span> CHECKING...'
        );

        $("#checkProgress").removeClass("d-none");

        // Simulated check: replace with API call later
        setTimeout(function () {

            const now = new Date();

            updateLastCheck(now.toISOString());

            $("#checkProgress").addClass("d-none");

            button.prop("disabled", false);

            button.html(
                '<i class="bi bi-arrow-repeat"></i> START CHECK NOTAM'
            );

            alert("Demo check completed successfully.");

        }, 2500);

    });

});
