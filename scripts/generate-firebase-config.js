#!/usr/bin/env node
/** Write web/assets/js/firebase-config.js from Vercel / local env vars. */
const fs = require("fs");
const path = require("path");

function clean(value) {
  return String(value || "").trim().split(/\s+/)[0] || "";
}

const cfg = {
  apiKey: clean(process.env.FIREBASE_API_KEY),
  authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN),
  projectId: clean(process.env.FIREBASE_PROJECT_ID),
  storageBucket: clean(process.env.FIREBASE_STORAGE_BUCKET || process.env.StorageBucket),
  messagingSenderId: clean(process.env.FIREBASE_MESSAGING_SENDER_ID),
  appId: clean(process.env.FIREBASE_APP_ID),
  measurementId: clean(process.env.FIREBASE_MEASUREMENT_ID),
};

const out = `/**
 * Firebase web config — generated at build from environment variables.
 */
window.SC_FIREBASE_CONFIG = ${JSON.stringify(cfg, null, 2)};

window.SC_API_BASE = window.SC_API_BASE || "";
`;

const target = path.join(__dirname, "..", "web", "assets", "js", "firebase-config.js");
fs.writeFileSync(target, out);
if (cfg.apiKey) {
  console.log("firebase-config.js written (Firebase auth enabled)");
} else {
  console.warn(
    "⚠️  firebase-config.js written with EMPTY values — Firebase env vars (FIREBASE_API_KEY, etc.) " +
    "must be set as VERCEL BUILD-TIME env vars for Firebase auth to work. " +
    "The dashboard will fall back to /api/firebase-config at runtime."
  );
}
