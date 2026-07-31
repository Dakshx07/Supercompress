#!/usr/bin/env bash
# Private GitLab mirror only (CI). Public releases use publish-github-release.sh
# Publish a SuperCompress GitLab release from CHANGELOG.md
#
# Usage:
#   scripts/publish-gitlab-release.sh 0.5.6
#   scripts/publish-gitlab-release.sh 0.5.6 --ref HEAD
#   scripts/publish-gitlab-release.sh 0.5.2 --dry-run
#
# Creates tag vX.Y.Z (if missing) and a GitLab release with notes
# extracted from CHANGELOG.md. Repo: arjunkshah/supercompress
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
shift || true
REF="HEAD"
DRY=0
REPO="${GL_REPO:-arjunkshah/supercompress}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version> [--ref REF] [--dry-run] [--repo group/project]" >&2
  exit 2
fi

VERSION="${VERSION#v}"
TAG="v${VERSION}"
CHANGELOG="$ROOT/CHANGELOG.md"

if [[ ! -f "$CHANGELOG" ]]; then
  echo "Missing CHANGELOG.md" >&2
  exit 1
fi

NOTES="$(python3 - "$CHANGELOG" "$VERSION" <<'PY'
import re, sys
path, ver = sys.argv[1], sys.argv[2]
text = open(path).read()
# Match ## [0.5.6] — date ... until next ## heading
pat = rf"(?ms)^## \[{re.escape(ver)}\][^\n]*\n(.*?)(?=^## |\Z)"
m = re.search(pat, text)
if not m:
    sys.stderr.write(f"No CHANGELOG section for [{ver}]\n")
    sys.exit(1)
body = m.group(1).strip()
print(f"## SuperCompress {ver}\n\n{body}\n\n---\nFull changelog: https://www.supercompress.dev/changelog\n")
PY
)"

NOTES_FILE="$(mktemp)"
printf '%s\n' "$NOTES" >"$NOTES_FILE"
trap 'rm -f "$NOTES_FILE"' EXIT

echo "→ version $VERSION  tag $TAG  ref $REF  repo $REPO"
echo "── notes ──"
cat "$NOTES_FILE"
echo "───────────"

if [[ "$DRY" -eq 1 ]]; then
  echo "(dry-run) skipping tag + release"
  exit 0
fi

if ! command -v glab >/dev/null 2>&1; then
  echo "glab is required" >&2
  exit 1
fi

# Create annotated tag if missing (local + push)
if ! git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Creating tag $TAG at $REF"
  git tag -a "$TAG" "$REF" -m "SuperCompress $VERSION"
  git push gl "$TAG"
else
  echo "Tag $TAG already exists"
  # Ensure remote has it
  git push gl "$TAG" 2>/dev/null || true
fi

# Create or update GitLab release
if glab release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "Updating existing release $TAG"
  glab release update "$TAG" -R "$REPO" -F "$NOTES_FILE" --name "SuperCompress $VERSION"
else
  echo "Creating release $TAG"
  glab release create "$TAG" -R "$REPO" --name "SuperCompress $VERSION" -F "$NOTES_FILE" --ref "$REF"
fi

echo "✓ https://gitlab.com/${REPO}/-/releases/${TAG}"
