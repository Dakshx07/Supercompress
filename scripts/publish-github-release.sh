#!/usr/bin/env bash
# Publish a GitHub release from CHANGELOG.md
# Usage: scripts/publish-github-release.sh 0.5.6
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="${1:?version required}"
VERSION="${VERSION#v}"
TAG="v${VERSION}"
REPO="${GH_REPO:-Supercompress/Supercompress}"
NOTES_FILE="$(mktemp)"
python3 - "$ROOT/CHANGELOG.md" "$VERSION" >"$NOTES_FILE" <<'PY'
import re, sys
path, ver = sys.argv[1], sys.argv[2]
text = open(path).read()
pat = rf"(?ms)^## \[{re.escape(ver)}\][^\n]*\n(.*?)(?=^## |\Z)"
m = re.search(pat, text)
if not m:
    raise SystemExit(f"No CHANGELOG section for [{ver}]")
body = m.group(1).strip().rstrip('-').rstrip()
print(f"## SuperCompress {ver}\n\n{body}\n\nFull changelog: https://www.supercompress.dev/changelog\n")
PY
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  git tag -a "$TAG" HEAD -m "SuperCompress $VERSION"
fi
git push github "$TAG" 2>/dev/null || git push origin "$TAG"
gh release create "$TAG" --repo "$REPO" --title "SuperCompress $VERSION" --notes-file "$NOTES_FILE" \
  || gh release edit "$TAG" --repo "$REPO" --notes-file "$NOTES_FILE" --title "SuperCompress $VERSION"
rm -f "$NOTES_FILE"
echo "✓ https://github.com/${REPO}/releases/tag/${TAG}"
