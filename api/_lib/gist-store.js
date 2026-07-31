/**
 * Durable JSON store backed by a secret GitHub Gist.
 * Used when Cloud Firestore is unavailable (common on Spark projects
 * without billing). Never creates Firebase Auth stub users.
 */

const GIST_ID = () => String(process.env.SUPERCOMPRESS_STORE_GIST_ID || "").trim();
const GITHUB_TOKEN = () => String(process.env.SUPERCOMPRESS_STORE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
const FILE_NAME = "store.json";

function gistConfigured() {
  return Boolean(GIST_ID() && GITHUB_TOKEN());
}

async function gh(pathname, opts = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`GitHub gist store error (${res.status}): ${typeof body === "object" ? body.message || JSON.stringify(body) : text}`);
    err.status = res.status === 403 || res.status === 401 ? 503 : 502;
    throw err;
  }
  return body;
}

async function loadGistStore() {
  if (!gistConfigured()) return null;
  const gist = await gh(`/gists/${GIST_ID()}`);
  const file = gist.files?.[FILE_NAME] || Object.values(gist.files || {})[0];
  if (!file) return { keys: {}, hash_index: {}, usage: {}, _version: 0 };
  let content = file.content;
  if (!content && file.raw_url) {
    const raw = await fetch(file.raw_url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN()}`, Accept: "application/vnd.github.raw" },
    });
    content = await raw.text();
  }
  try {
    return JSON.parse(content || "{}");
  } catch {
    return { keys: {}, hash_index: {}, usage: {}, _version: 0 };
  }
}

async function saveGistStore(data) {
  if (!gistConfigured()) {
    const err = new Error("Gist store is not configured");
    err.status = 503;
    throw err;
  }
  await gh(`/gists/${GIST_ID()}`, {
    method: "PATCH",
    body: JSON.stringify({
      files: {
        [FILE_NAME]: {
          content: JSON.stringify(data, null, 2),
        },
      },
    }),
  });
  return data;
}

module.exports = {
  gistConfigured,
  loadGistStore,
  saveGistStore,
};
