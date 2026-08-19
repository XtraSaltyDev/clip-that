#!/usr/bin/env bash

# Build the exact LGPL-compatible FFmpeg toolchain shipped in ClipThat's macOS app.
# The matching upstream source archives are retained for every binary release.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "ClipThat's bundled FFmpeg must be built on Apple-silicon macOS." >&2
  exit 1
fi

ffmpeg_version=9.0.1
ffmpeg_url="https://ffmpeg.org/releases/ffmpeg-$ffmpeg_version.tar.xz"
ffmpeg_sha256=cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635

libvpx_version=1.16.0
libvpx_url="https://storage.googleapis.com/downloads.webmproject.org/releases/webm/libvpx-$libvpx_version.tar.gz"
libvpx_sha256=b19c48b6384c5f9352d4c861a9659e3e7041918aad23da63e84559674816adac

opus_version=1.6.1
opus_url="https://downloads.xiph.org/releases/opus/opus-$opus_version.tar.gz"
opus_sha256=6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1

vendor_root="$PWD/build/vendor/ffmpeg"
download_dir="$vendor_root/downloads"
work_dir="$vendor_root/work"
prefix="$vendor_root/prefix"
package_dir="$vendor_root/package"
source_contents="$vendor_root/source-bundle"
source_bundle="$vendor_root/ClipThat-third-party-sources.tar.gz"
build_info="$package_dir/BUILD-FFMPEG.txt"

ffmpeg_archive="$download_dir/ffmpeg-$ffmpeg_version.tar.xz"
libvpx_archive="$download_dir/libvpx-$libvpx_version.tar.gz"
opus_archive="$download_dir/opus-$opus_version.tar.gz"

verify_bundled_build() {
  [[ -x "$package_dir/bin/ffmpeg" && -x "$package_dir/bin/ffprobe" && -s "$source_bundle" ]] || return 1
  local buildconf encoders
  buildconf=$("$package_dir/bin/ffmpeg" -hide_banner -buildconf 2>&1)
  grep -q -- '--disable-gpl' <<<"$buildconf" || return 1
  grep -q -- '--disable-nonfree' <<<"$buildconf" || return 1
  ! grep -q -- '--enable-gpl' <<<"$buildconf" || return 1
  ! grep -q -- '--enable-nonfree' <<<"$buildconf" || return 1
  encoders=$("$package_dir/bin/ffmpeg" -hide_banner -encoders 2>&1)
  grep -q 'h264_videotoolbox' <<<"$encoders" || return 1
  grep -q 'libvpx-vp9' <<<"$encoders" || return 1
  grep -q 'libopus' <<<"$encoders" || return 1
  ! grep -qF "$vendor_root" <<<"$buildconf" || return 1
  ! otool -L "$package_dir/bin/ffmpeg" "$package_dir/bin/ffprobe" \
    | awk '/^[[:space:]]/ { print }' | grep -F "$vendor_root" || return 1
  ! find "$package_dir" \( -name '.env' -o -name '.env.*' \) -print | grep -q . || return 1
}

if verify_bundled_build; then
  echo "Using verified FFmpeg $ffmpeg_version build at $package_dir"
  exit 0
fi

command -v xcrun >/dev/null 2>&1 || {
  echo "Xcode command-line tools are required to build FFmpeg." >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || {
  echo "curl is required to download the pinned source archives." >&2
  exit 1
}

jobs=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
mkdir -p "$download_dir"

download_and_verify() {
  local url=$1
  local destination=$2
  local expected=$3
  if [[ -f "$destination" ]] && \
    [[ "$(shasum -a 256 "$destination" | awk '{print $1}')" == "$expected" ]]; then
    return
  fi
  curl --fail --location --retry 3 --output "$destination.download" "$url"
  local actual
  actual=$(shasum -a 256 "$destination.download" | awk '{print $1}')
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 mismatch for $url" >&2
    echo "Expected: $expected" >&2
    echo "Actual:   $actual" >&2
    exit 1
  fi
  mv "$destination.download" "$destination"
}

download_and_verify "$ffmpeg_url" "$ffmpeg_archive" "$ffmpeg_sha256"
download_and_verify "$libvpx_url" "$libvpx_archive" "$libvpx_sha256"
download_and_verify "$opus_url" "$opus_archive" "$opus_sha256"

rm -rf "$work_dir" "$prefix" "$package_dir" "$source_contents" "$source_bundle"
mkdir -p "$work_dir" "$prefix" "$package_dir/bin" \
  "$package_dir/licenses" "$source_contents"

tar -xf "$ffmpeg_archive" -C "$work_dir"
tar -xzf "$libvpx_archive" -C "$work_dir"
tar -xzf "$opus_archive" -C "$work_dir"

export MACOSX_DEPLOYMENT_TARGET=12.0
export CFLAGS="-O2 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"

(
  cd "$work_dir/libvpx-$libvpx_version"
  ./configure \
    --prefix="$prefix" \
    --target=arm64-darwin20-gcc \
    --disable-examples \
    --disable-tools \
    --disable-docs \
    --disable-unit-tests \
    --disable-shared \
    --enable-static
  make -j"$jobs"
  make install
)

(
  cd "$work_dir/opus-$opus_version"
  ./configure \
    --prefix="$prefix" \
    --disable-shared \
    --enable-static \
    --disable-extra-programs \
    --disable-doc
  make -j"$jobs"
  make install
)

pkg_config="$work_dir/clipthat-pkg-config"
cat >"$pkg_config" <<'PKG_CONFIG'
#!/bin/sh
set -eu

prefix=${CLIPTHAT_CODEC_PREFIX:?CLIPTHAT_CODEC_PREFIX is required}
arguments="$*"
case "$arguments" in
  *--version*) printf '%s\n' '1.0'; exit 0 ;;
esac
case "$arguments" in
  *vpx*) package=vpx ;;
  *opus*) package=opus ;;
  *) exit 1 ;;
esac

case "$arguments" in
  *--exists*|*--atleast-version*) exit 0 ;;
  *--variable=includedir*) printf '%s\n' "$prefix/include" ;;
  *--modversion*)
    if [ "$package" = vpx ]; then printf '%s\n' '1.16.0'; else printf '%s\n' '1.6.1'; fi
    ;;
  *--cflags*)
    if [ "$package" = vpx ]; then
      printf '%s\n' "-I$prefix/include"
    else
      printf '%s\n' "-I$prefix/include/opus"
    fi
    ;;
  *--libs*)
    if [ "$package" = vpx ]; then
      printf '%s\n' "-L$prefix/lib -lvpx -lm -lpthread"
    else
      printf '%s\n' "-L$prefix/lib -lopus -lm"
    fi
    ;;
  *) exit 1 ;;
esac
PKG_CONFIG
chmod 755 "$pkg_config"

export CLIPTHAT_CODEC_PREFIX="$prefix"
ffmpeg_configure=(
  --prefix=/clipthat/ffmpeg
  --arch=arm64
  --cc=clang
  --disable-gpl
  --disable-nonfree
  --disable-doc
  --disable-debug
  --disable-ffplay
  --disable-network
  --enable-static
  --disable-shared
  --enable-libvpx
  --enable-libopus
  --enable-videotoolbox
  --enable-audiotoolbox
  --pkg-config=../clipthat-pkg-config
  --pkg-config-flags=--static
  "--extra-cflags=-I../../prefix/include -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
  "--extra-ldflags=-L../../prefix/lib -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
)

(
  cd "$work_dir/ffmpeg-$ffmpeg_version"
  ./configure "${ffmpeg_configure[@]}"
  make -j"$jobs"
)

install -m 755 "$work_dir/ffmpeg-$ffmpeg_version/ffmpeg" "$package_dir/bin/ffmpeg"
install -m 755 "$work_dir/ffmpeg-$ffmpeg_version/ffprobe" "$package_dir/bin/ffprobe"
cp "$work_dir/ffmpeg-$ffmpeg_version/LICENSE.md" "$package_dir/licenses/FFmpeg-LICENSE.md"
cp "$work_dir/ffmpeg-$ffmpeg_version/COPYING.LGPLv2.1" "$package_dir/licenses/FFmpeg-COPYING.LGPLv2.1"
cp "$work_dir/libvpx-$libvpx_version/LICENSE" "$package_dir/licenses/libvpx-LICENSE"
cp "$work_dir/opus-$opus_version/COPYING" "$package_dir/licenses/Opus-COPYING"

cat >"$build_info" <<EOF
ClipThat bundled FFmpeg build
=============================

Target: macOS 12 or later, arm64
Source modifications: none

FFmpeg $ffmpeg_version
  Source: $ffmpeg_url
  SHA-256: $ffmpeg_sha256
  License mode: LGPL v2.1 or later (--disable-gpl --disable-nonfree)

libvpx $libvpx_version
  Source: $libvpx_url
  SHA-256: $libvpx_sha256
  License: BSD 3-Clause

Opus $opus_version
  Source: $opus_url
  SHA-256: $opus_sha256
  License: BSD 3-Clause

libvpx configure:
  ./configure --prefix=PREFIX --target=arm64-darwin20-gcc --disable-examples --disable-tools --disable-docs --disable-unit-tests --disable-shared --enable-static

Opus configure:
  ./configure --prefix=PREFIX --disable-shared --enable-static --disable-extra-programs --disable-doc

FFmpeg configure:
  ./configure --prefix=PREFIX --arch=arm64 --cc=clang --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-ffplay --disable-network --enable-static --disable-shared --enable-libvpx --enable-libopus --enable-videotoolbox --enable-audiotoolbox --pkg-config=PKG_CONFIG --pkg-config-flags=--static --extra-cflags='-IPREFIX/include -mmacosx-version-min=12.0' --extra-ldflags='-LPREFIX/lib -mmacosx-version-min=12.0'

Build command:
  npm run build:ffmpeg:mac
EOF

cp "$ffmpeg_archive" "$source_contents/"
cp "$libvpx_archive" "$source_contents/"
cp "$opus_archive" "$source_contents/"
cp "$build_info" "$source_contents/BUILD-FFMPEG.txt"
cp -R "$package_dir/licenses" "$source_contents/licenses"
(
  cd "$source_contents"
  tar -czf "$source_bundle" .
)

verify_bundled_build || {
  echo "The newly built FFmpeg did not pass ClipThat's codec and license checks." >&2
  exit 1
}

if otool -L "$package_dir/bin/ffmpeg" "$package_dir/bin/ffprobe" \
  | awk '/^[[:space:]]/ { print }' | grep -F "$vendor_root"; then
  echo "The bundled FFmpeg tools contain a build-directory linkage." >&2
  exit 1
fi

if find "$package_dir" -name '.env' -o -name '.env.*' | grep -q .; then
  echo "A forbidden environment file was found in the FFmpeg package." >&2
  exit 1
fi

echo "Built and verified FFmpeg $ffmpeg_version and $source_bundle"
