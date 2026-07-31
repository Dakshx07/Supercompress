#!/usr/bin/env node
/**
 * Generate a large, noisy auth-service log with one buried incident.
 * Run: node examples/yc-demo/generate-log.js
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "auth-service.log");
const TARGET_CHARS = 110_000;

const NEEDLE = [
  "2026-07-27T14:22:01.110Z ERROR [auth] session.refresh failed user_id=usr_9f2a reason=refresh_token_reuse detected=true",
  "2026-07-27T14:22:01.118Z WARN  [auth] rotating refresh token family_id=fam_44c1 old_jti=jti_a91b new_jti=jti_b02c",
  "2026-07-27T14:22:01.125Z ERROR [auth] SessionStore.get returned null after rotate user_id=usr_9f2a store=redis key=sess:usr_9f2a:fam_44c1",
  "2026-07-27T14:22:01.131Z ERROR [api] POST /v1/auth/refresh status=401 duration_ms=47 code=AUTH_REFRESH_REUSE",
  "2026-07-27T14:22:01.140Z INFO  [audit] security_event type=refresh_reuse user_id=usr_9f2a ip=203.0.113.44 ua=\"Cursor/1.2\"",
  "2026-07-27T14:22:01.148Z INFO  [auth] notifying security_ops channel=#auth-alerts severity=high",
  "2026-07-27T14:22:01.155Z ERROR [auth] Aborting session chain — possible stolen refresh token. Remediation: revoke fam_44c1 and force re-login",
  "2026-07-27T14:22:01.162Z INFO  [auth] revoked token_family fam_44c1 sessions_cleared=3",
];

const NEEDLE_PAYMENTS = [
  "2026-07-27T14:31:00.001Z ERROR [payments] stripe card_declined charge=ch_test_001 amount=1990",
  "2026-07-27T14:31:00.020Z WARN  [payments] retry scheduled in 300s charge=ch_test_001",
];

function ts(i) {
  const base = Date.parse("2026-07-27T13:00:00.000Z");
  return new Date(base + i * 1700).toISOString();
}

function noiseLine(i) {
  const r = i % 11;
  if (r === 0) return `${ts(i)} INFO  [gateway] request_id=req_${String(i).padStart(5, "0")} method=POST path=/v1/events status=201 bytes=${120 + (i % 40)}`;
  if (r === 1) return `${ts(i)} INFO  [gateway] request_id=req_${String(i).padStart(5, "0")} method=GET path=/health status=200`;
  if (r === 2) return `${ts(i)} INFO  [api] GET /v1/users/${2000 + (i % 200)} status=200 duration_ms=${12 + (i % 40)}`;
  if (r === 3) return `${ts(i)} DEBUG [cache] redis GET session:${1000 + (i % 80)} miss=false ttl=3400`;
  if (r === 4) return `${ts(i)} INFO  [worker] job=email_digest id=jd_${i % 90} status=ok attempts=1`;
  if (r === 5) return `${ts(i)} INFO  [metrics] http_requests_total=${18000 + i} latency_p95_ms=${40 + (i % 30)} queue_depth=${i % 12}`;
  if (r === 6) return `${ts(i)} INFO  [gateway] request_id=req_${String(i).padStart(5, "0")} method=GET path=/v1/status status=200`;
  if (r === 7) return `${ts(i)} DEBUG [db] SELECT users WHERE id=${i % 500} rows=1 ms=${2 + (i % 8)}`;
  if (r === 8) return `${ts(i)} INFO  [worker] job=webhook_delivery id=wh_${i % 70} status=ok attempts=1`;
  if (r === 9) return `${ts(i)} INFO  [metrics] cpu_pct=${20 + (i % 15)} mem_pct=${45 + (i % 20)} goroutines=${180 + (i % 40)}`;
  return `${ts(i)} INFO  [gateway] keepalive peer=edge-${i % 6} rtt_ms=${8 + (i % 12)}`;
}

const lines = [];
let i = 0;
while (lines.join("\n").length < TARGET_CHARS * 0.48) {
  lines.push(noiseLine(i++));
}
for (const line of NEEDLE) lines.push(line);
while (lines.join("\n").length < TARGET_CHARS * 0.85) {
  lines.push(noiseLine(i++));
}
for (const line of NEEDLE_PAYMENTS) lines.push(line);
while (lines.join("\n").length < TARGET_CHARS) {
  lines.push(noiseLine(i++));
}

fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT}`);
console.log(`  lines=${lines.length} chars=${fs.statSync(OUT).size}`);
console.log(`  needle at lines ${Math.floor(lines.length / 2) - 4}… (usr_9f2a / AUTH_REFRESH_REUSE)`);
