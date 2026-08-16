/**
 * Shared retention for replayable / reversible content.
 * Keep in sync with privacy policy § Retention.
 */
const REPLAY_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
/** CCR stores removed original blocks for the same window as compress response replay. */
const CCR_TTL_MS = REPLAY_TTL_MS;

module.exports = { REPLAY_TTL_MS, CCR_TTL_MS };
