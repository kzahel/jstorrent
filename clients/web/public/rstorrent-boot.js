(function () {
  "use strict";

  // Tactical 352: before the application bundle the page is only the
  // application's background in the stored theme, so the first render does
  // not flash. Mirrors APPEARANCE_STORAGE_KEY and its version in appearance.ts.
  var APPEARANCE_STORAGE_KEY = "rstorrent.presentation.appearance";
  var APPEARANCE_VERSION = 3;
  var COLOR_THEMES = { auto: true, light: true, dark: true };
  var INTERFACE_SIZES = { compact: true, standard: true, spacious: true };

  try {
    window.performance.mark("jstorrent:startup:boot");
  } catch (error) {
    // Timing is diagnostic only.
  }

  try {
    var stored = JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) || "null");
    if (stored !== null && typeof stored === "object" && stored.version === APPEARANCE_VERSION) {
      var root = document.documentElement;
      if (COLOR_THEMES[stored.colorTheme] === true) {
        root.setAttribute("data-color-theme", stored.colorTheme);
        var scheme = document.querySelector('meta[name="color-scheme"]');
        if (scheme !== null) {
          scheme.setAttribute("content", stored.colorTheme === "auto" ? "light dark" : stored.colorTheme);
        }
      }
      if (INTERFACE_SIZES[stored.interfaceSize] === true) {
        root.setAttribute("data-interface-size", stored.interfaceSize);
      }
    }
  } catch (error) {
    // Storage can be unavailable; the application applies its defaults.
  }

  function showFailure() {
    var status = document.getElementById("rstorrent-boot-status");
    if (status !== null) {
      status.setAttribute("role", "alert");
      status.textContent =
        "JSTorrent could not start. Reload this page to fetch the current application files.";
    }
  }

  window.addEventListener("error", showFailure);
  window.addEventListener("unhandledrejection", showFailure);
  window.setTimeout(showFailure, 10000);
})();
