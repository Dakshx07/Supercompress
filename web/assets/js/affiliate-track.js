/**
 * Affiliate referral tracking — client-side.
 * Included on every page via <script> tag.
 *
 * 1. Reads ?ref=slug from the URL on page load
 * 2. Sets a 30-day cookie sc_ref=slug so it persists across navigation
 * 3. Fire-and-forget ping to /api/affiliates (action:track) to log the visit
 * 4. Exposes window.SCAffiliate = { getRef(), clearRef() } for other scripts
 */
(function () {
  "use strict";

  const COOKIE_NAME = "sc_ref";
  const COOKIE_DAYS = 30;
  const API_BASE = window.SC_API_BASE || "";

  /* ── Cookie helpers ── */

  function getCookie(name) {
    const match = document.cookie.match(
      new RegExp("(?:^|;\\s*)" + encodeURIComponent(name) + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      encodeURIComponent(name) +
      "=" +
      encodeURIComponent(value) +
      "; expires=" +
      expires +
      "; path=/; SameSite=Lax";
  }

  function clearCookie(name) {
    document.cookie =
      encodeURIComponent(name) +
      "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax";
  }

  /* ── URL param reader ── */

  function getParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  /* ── Main tracking logic ── */

  function trackRef(refSlug) {
    if (!refSlug) return;

    // Set the cookie
    setCookie(COOKIE_NAME, refSlug, COOKIE_DAYS);

    // Fire-and-forget: log this visit to the server
    try {
      const payload = JSON.stringify({
        action: "track",
        ref: refSlug,
        page: window.location.pathname,
        referrer: document.referrer || null,
        ts: new Date().toISOString(),
      });
      if ("sendBeacon" in navigator) {
        navigator.sendBeacon(API_BASE + "/api/affiliates", payload);
      } else {
        var xhr = new XMLHttpRequest(); // var to avoid block optimizations
        xhr.open("POST", API_BASE + "/api/affiliates", true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(payload);
      }
    } catch (_) {
      /* non-critical — fire-and-forget */
    }
  }

  /* ── Public API ── */

  window.SCAffiliate = {
    /** Returns the current referral slug from cookie, or null. */
    getRef: function () {
      return getCookie(COOKIE_NAME);
    },
    /** Clears the referral cookie. */
    clearRef: function () {
      clearCookie(COOKIE_NAME);
    },
  };

  /* ── Bootstrap ── */

  // Check URL for ref= param on every page load
  var refFromUrl = getParam("ref");
  if (refFromUrl) {
    // Sanitize: only allow alphanumeric, underscore, hyphen
    var clean = refFromUrl.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    if (clean && clean.length >= 2 && clean.length <= 60) {
      trackRef(clean);
    }
  }
})();
