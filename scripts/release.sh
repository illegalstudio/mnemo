#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 0.2.0"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install it: brew install gh"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree not clean. Commit or stash changes first."
  exit 1
fi

TAG="v${VERSION}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# ── Load signing/notarization credentials if available ────────────
if [[ -f "$REPO_ROOT/.env.release" ]]; then
  source "$REPO_ROOT/.env.release"
  echo "==> Loaded signing credentials from .env.release"
else
  echo "==> No .env.release found — DMG will be unsigned"
fi

# ── 0. Check if release already exists ────────────────────────────
LOCAL_TAG=$(git tag -l "$TAG")
REMOTE_TAG=$(git ls-remote --tags origin "refs/tags/${TAG}" 2>/dev/null | head -1)
GH_RELEASE=$(gh release view "$TAG" --json tagName -q .tagName 2>/dev/null || true)

if [[ -n "$LOCAL_TAG" || -n "$REMOTE_TAG" || -n "$GH_RELEASE" ]]; then
  echo ""
  echo "⚠  Release ${TAG} already exists:"
  [[ -n "$LOCAL_TAG" ]]  && echo "   - Local tag"
  [[ -n "$REMOTE_TAG" ]] && echo "   - Remote tag"
  [[ -n "$GH_RELEASE" ]] && echo "   - GitHub release"
  echo ""
  read -rp "Overwrite? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi

  echo "==> Cleaning up existing release ${TAG}"
  [[ -n "$GH_RELEASE" ]] && gh release delete "$TAG" --yes 2>/dev/null || true
  [[ -n "$REMOTE_TAG" ]] && git push origin ":refs/tags/${TAG}" 2>/dev/null || true
  [[ -n "$LOCAL_TAG" ]]  && git tag -d "$TAG" 2>/dev/null || true
  echo ""
fi

echo "==> Releasing Mnemo ${TAG}"

# ── 1. Bump version in all manifests ──────────────────────────────
echo "==> Bumping version to ${VERSION}"

cd "$REPO_ROOT"

CURRENT_VERSION=$(node -p "require('./package.json').version")

if [[ "$CURRENT_VERSION" != "$VERSION" ]]; then
  npm version "$VERSION" --no-git-tag-version

  perl -i -pe "s/^version = \".*?\"/version = \"${VERSION}\"/" src-tauri/Cargo.toml
  perl -i -pe "s/\"version\": \".*?\"/\"version\": \"${VERSION}\"/" src-tauri/tauri.conf.json

  (cd src-tauri && cargo generate-lockfile)

  echo "==> Committing version bump"
  git add package.json bun.lock src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
  git commit -m "release: ${TAG}"
else
  echo "==> Version already at ${VERSION}, skipping bump"
fi

echo "==> Creating tag ${TAG}"
git tag -a "$TAG" -m "Release ${TAG}"

echo "==> Pushing to origin"
git push origin HEAD
git push origin "$TAG"

# ── 2. Build universal macOS DMG ─────────────────────────────────
echo "==> Building universal macOS DMG (this may take a few minutes)..."
bunx tauri build --target universal-apple-darwin

# ── 3. Find the DMG ──────────────────────────────────────────────
DMG_DIR="src-tauri/target/universal-apple-darwin/release/bundle/dmg"
DMG_FILE=$(find "$DMG_DIR" -name "*.dmg" -type f | head -1)

if [[ -z "$DMG_FILE" ]]; then
  echo "Error: no DMG found in ${DMG_DIR}"
  exit 1
fi

echo "==> Built: ${DMG_FILE}"

# ── 4. Create GitHub release + upload DMG ─────────────────────────
echo "==> Creating GitHub release ${TAG}"
gh release create "$TAG" \
  --title "Mnemo ${TAG}" \
  --generate-notes \
  "$DMG_FILE"

RELEASE_URL=$(gh release view "$TAG" --json url -q .url)
echo ""
echo "==> Done! Release published: ${RELEASE_URL}"
