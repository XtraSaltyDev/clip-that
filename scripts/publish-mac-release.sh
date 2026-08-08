#!/usr/bin/env bash

# Publish the already verified macOS delivery files as a GitHub release. Draft is the
# default so a release cannot become visible accidentally.

set -euo pipefail

cd "$(dirname "$0")/.."

mode=${1:---draft}
if [ "$mode" != "--draft" ] && [ "$mode" != "--publish" ]; then
  echo "Usage: $0 [--draft|--publish]" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required to publish a release." >&2
  exit 1
fi

version=$(node -p "require('./package.json').version")
tag="v$version"
dmg="dist/ClipThat-$version-arm64.dmg"
zip="dist/ClipThat-$version-arm64-mac.zip"
checksums="dist/ClipThat-$version-SHA256SUMS.txt"
zip_blockmap="$zip.blockmap"
latest_macos="dist/latest-mac.yml"

for artifact in "$dmg" "$zip" "$zip_blockmap" "$latest_macos" "$checksums"; do
  if [ ! -f "$artifact" ]; then
    echo "Missing verified macOS release artifact: $artifact" >&2
    exit 1
  fi
done

(
  cd dist
  shasum -a 256 -c "ClipThat-$version-SHA256SUMS.txt"
)

repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
target=${GITHUB_SHA:-$(git rev-parse HEAD)}

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "GitHub release $tag already exists in $repo." >&2
  exit 1
fi
if git ls-remote --exit-code --tags "https://github.com/$repo.git" \
  "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Git tag $tag already exists in $repo." >&2
  exit 1
fi

args=(
  release create "$tag"
  "$dmg"
  "$zip"
  "$zip_blockmap"
  "$latest_macos"
  "$checksums"
  --repo "$repo"
  --target "$target"
  --title "ClipThat $version"
  --generate-notes
)
if [ "$mode" = "--draft" ]; then
  args+=(--draft)
fi

gh "${args[@]}"
