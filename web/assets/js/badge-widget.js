/**
 * SuperCompress Badge Widget
 * ============================
 * Embeddable widget that displays a "Compressed by SuperCompress" badge
 * on any website. Shows live token savings impact.
 *
 * Usage:
 *   <script src="https://supercompress.dev/assets/js/badge-widget.js"
 *           data-token-savings="65000000"
 *           data-position="bottom-right">
 *   </script>
 *
 * Attributes:
 *   data-token-savings  - Total tokens saved (default: auto-estimate)
 *   data-position       - 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'static'
 *   data-theme          - 'dark' | 'light' | 'auto' (default: auto)
 *   data-no-link        - Set to 'true' to hide the link (discouraged)
 *   data-compact        - Set to 'true' for a smaller inline variant
 *
 * License: MIT — freely embeddable. No tracking, no analytics.
 */

(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;

  var TOKENS_SAVED = SCRIPT.getAttribute("data-token-savings") || null;
  var POSITION = SCRIPT.getAttribute("data-position") || "bottom-right";
  var THEME = SCRIPT.getAttribute("data-theme") || "auto";
  var NO_LINK = SCRIPT.getAttribute("data-no-link") === "true";
  var COMPACT = SCRIPT.getAttribute("data-compact") === "true";

  // ── Detect theme ──
  var isDark =
    THEME === "dark" ||
    (THEME === "auto" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  // ── Format numbers ──
  function fmt(n) {
    if (!n) return "10M+";
    n = parseInt(n, 10);
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + "B";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // ── Build widget ──
  var container = document.createElement("div");
  container.id = "sc-badge-widget";

  var bg = isDark ? "#1c1c2e" : "#ffffff";
  var text = isDark ? "#e0e0f0" : "#1a1a2e";
  var muted = isDark ? "#888" : "#666";
  var accent = isDark ? "#a78bfa" : "#7c3aed";
  var border = isDark ? "#2d2d44" : "#e5e5ea";

  var styles = {
    "bottom-right": "bottom: 24px; right: 24px;",
    "bottom-left": "bottom: 24px; left: 24px;",
    "top-right": "top: 24px; right: 24px;",
    "top-left": "top: 24px; left: 24px;",
    static: "position: relative; margin: 16px 0;",
  };

  var posStyle = styles[POSITION] || styles["bottom-right"];

  var gap = COMPACT ? "6px" : "10px";
  var padding = COMPACT ? "6px 12px" : "10px 18px 10px 14px";
  var radius = COMPACT ? "8px" : "12px";
  var fontSize = COMPACT ? "10px" : "12px";

  container.style.cssText =
    "display:inline-flex;align-items:center;gap:" + gap + ";" +
    "padding:" + padding + ";" +
    "background:" + bg + ";" +
    "border:1px solid " + border + ";" +
    "border-radius:" + radius + ";" +
    "font-family:system-ui,-apple-system,sans-serif;" +
    "font-size:" + fontSize + ";line-height:1.4;" +
    "color:" + text + ";" +
    "box-shadow:0 2px 12px rgba(0,0,0," + (isDark ? "0.4" : "0.08") + ");" +
    "z-index:999999;" +
    "box-sizing:border-box;" +
    (POSITION !== "static" ? "position:fixed;" + posStyle : posStyle);

  // Icon
  var icon = document.createElement("span");
  icon.textContent = "\u26A1";
  icon.style.cssText = "font-size:" + (COMPACT ? "12px" : "16px") + ";line-height:1;";



  // Text content
  var content = document.createElement("span");
  content.style.cssText = "display:flex;flex-direction:column;gap:1px;";

  var topLine = document.createElement("span");
  topLine.style.cssText = "font-size:10px;color:" + muted + ";letter-spacing:0.02em;";
  topLine.textContent = "Compressed by";

  var brandLine = document.createElement("span");
  brandLine.style.cssText =
    "font-weight:700;font-size:" + (COMPACT ? "11px" : "13px") + ";color:" + accent + ";letter-spacing:-0.01em;";

  if (NO_LINK) {
    brandLine.textContent = "SuperCompress";
  } else {
    var link = document.createElement("a");
    link.href = "https://supercompress.dev";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "SuperCompress";
    link.style.cssText =
      "color:" + accent + ";text-decoration:none;" +
      "transition:opacity 0.15s;";
    link.onmouseover = function () { link.style.opacity = "0.8"; };
    link.onmouseout = function () { link.style.opacity = "1"; };
    brandLine.appendChild(link);
  }

  // Stats badge (hidden in compact mode)
  var statsBadge = null;
  if (!COMPACT) {
    statsBadge = document.createElement("span");
    statsBadge.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;" +
      "padding:2px 8px;border-radius:999px;" +
      "background:" + (isDark ? "#0d0d16" : "#f5f5fa") + ";" +
      "border:1px solid " + border + ";" +
      "font-size:10px;font-weight:600;color:" + muted + ";";

    var bolt = document.createElement("span");
    bolt.textContent = "\u2705";
    bolt.style.cssText = "font-size:9px;";

    statsBadge.appendChild(bolt);
    statsBadge.appendChild(document.createTextNode(fmt(TOKENS_SAVED) + " tokens saved"));
  }

  content.appendChild(topLine);
  content.appendChild(brandLine);

  container.appendChild(icon);
  container.appendChild(content);
  container.appendChild(statsBadge);

  // Close button
  var closeBtn = document.createElement("button");
  closeBtn.textContent = "\u00D7";
  closeBtn.style.cssText =
    "all:unset;cursor:pointer;font-size:14px;color:" + muted + ";" +
    "opacity:0.5;padding:2px;line-height:1;" +
    "transition:opacity 0.15s;margin-left:2px;";
  closeBtn.onmouseover = function () { closeBtn.style.opacity = "1"; };
  closeBtn.onmouseout = function () { closeBtn.style.opacity = "0.5"; };
  closeBtn.onclick = function () {
    container.style.transition = "opacity 0.3s, transform 0.3s";
    container.style.opacity = "0";
    container.style.transform = "scale(0.95)";
    setTimeout(function () { container.remove(); }, 300);
  };
  container.appendChild(closeBtn);

  // Wait for DOM, then append
  if (document.body) {
    document.body.appendChild(container);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.appendChild(container);
    });
  }
})();
