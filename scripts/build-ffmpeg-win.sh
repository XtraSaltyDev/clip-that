#!/usr/bin/env bash

# Build the exact LGPL-compatible FFmpeg toolchain shipped in ClipThat's Windows x64
# candidate. Run this script from an MSYS2 MINGW64 shell on Windows.

set -euo pipefail

cd "$(dirname "$0")/.."

case "$(uname -s)" in
  MINGW64_NT-*|MSYS_NT-*) ;;
  *)
    echo "ClipThat's Windows FFmpeg must be built in an MSYS2 MINGW64 shell." >&2
    exit 1
    ;;
esac

if [[ "${MSYSTEM:-}" != "MINGW64" ]]; then
  echo "MSYSTEM must be MINGW64; got ${MSYSTEM:-unset}." >&2
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

vendor_root="$PWD/build/vendor/ffmpeg/windows-x64"
download_dir="$vendor_root/downloads"
work_dir="$vendor_root/work"
prefix="$vendor_root/prefix"
package_dir="$vendor_root/package"
source_contents="$vendor_root/source-bundle"
source_bundle="$vendor_root/ClipThat-windows-third-party-sources.tar.gz"
build_info="$package_dir/BUILD-FFMPEG.txt"

ffmpeg_archive="$download_dir/ffmpeg-$ffmpeg_version.tar.xz"
libvpx_archive="$download_dir/libvpx-$libvpx_version.tar.gz"
opus_archive="$download_dir/opus-$opus_version.tar.gz"

verify_bundled_build() {
  [[ -x "$package_dir/bin/ffmpeg.exe" && -x "$package_dir/bin/ffprobe.exe" && -s "$source_bundle" ]] || return 1

  local buildconf encoders filters dependencies
  buildconf=$("$package_dir/bin/ffmpeg.exe" -hide_banner -buildconf 2>&1) || return 1
  grep -q -- '--disable-gpl' <<<"$buildconf" || return 1
  grep -q -- '--disable-nonfree' <<<"$buildconf" || return 1
  grep -q -- '--enable-mediafoundation' <<<"$buildconf" || return 1
  grep -q -- '--enable-libvpx' <<<"$buildconf" || return 1
  grep -q -- '--enable-libopus' <<<"$buildconf" || return 1
  ! grep -qE -- '--enable-(gpl|nonfree)' <<<"$buildconf" || return 1
  ! grep -qE '/[dD]/a/|build/vendor|windows-x64' <<<"$buildconf" || return 1

  encoders=$("$package_dir/bin/ffmpeg.exe" -hide_banner -encoders 2>&1) || return 1
  for encoder in h264_mf libvpx-vp9 libopus gif aac; do
    grep -q " $encoder " <<<"$encoders" || return 1
  done
  filters=$("$package_dir/bin/ffmpeg.exe" -hide_banner -filters 2>&1) || return 1
  grep -q ' palettegen ' <<<"$filters" || return 1
  grep -q ' paletteuse ' <<<"$filters" || return 1

  dependencies=$(objdump -p "$package_dir/bin/ffmpeg.exe" "$package_dir/bin/ffprobe.exe" \
    | sed -n 's/.*DLL Name: //p')
  ! grep -qiE 'libgcc|libstdc\+\+|libwinpthread|libvpx|libopus' <<<"$dependencies" || return 1
  ! find "$package_dir" \( -name '.env' -o -name '.env.*' \) -print | grep -q . || return 1
}

if verify_bundled_build; then
  echo "Using verified Windows FFmpeg $ffmpeg_version build at $package_dir"
  exit 0
fi

for command in curl make gcc ar strip objdump nasm pkg-config tar xz; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required to build Windows FFmpeg." >&2
    exit 1
  }
done

jobs=${NUMBER_OF_PROCESSORS:-4}
mkdir -p "$download_dir"

download_and_verify() {
  local url=$1
  local destination=$2
  local expected=$3
  if [[ -f "$destination" ]] && \
    [[ "$(sha256sum "$destination" | awk '{print $1}')" == "$expected" ]]; then
    return
  fi
  curl --fail --location --retry 3 --output "$destination.download" "$url"
  local actual
  actual=$(sha256sum "$destination.download" | awk '{print $1}')
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

export CFLAGS='-O2'
export CXXFLAGS="$CFLAGS"

(
  cd "$work_dir/libvpx-$libvpx_version"
  ./configure \
    --prefix="$prefix" \
    --target=x86_64-win64-gcc \
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
    --host=x86_64-w64-mingw32 \
    --prefix="$prefix" \
    --disable-shared \
    --enable-static \
    --disable-extra-programs \
    --disable-doc
  make -j"$jobs"
  make install
)

export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
ffmpeg_configure=(
  --prefix=C:/clipthat/ffmpeg
  --target-os=mingw32
  --arch=x86_64
  --cc=gcc
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
  --enable-mediafoundation
  --pkg-config-flags=--static
  "--extra-cflags=-I../../prefix/include -I../../prefix/include/opus"
  "--extra-ldflags=-L../../prefix/lib -static -static-libgcc"
)

(
  cd "$work_dir/ffmpeg-$ffmpeg_version"
  ./configure "${ffmpeg_configure[@]}"
  make -j"$jobs"
)

install -m 755 "$work_dir/ffmpeg-$ffmpeg_version/ffmpeg.exe" "$package_dir/bin/ffmpeg.exe"
install -m 755 "$work_dir/ffmpeg-$ffmpeg_version/ffprobe.exe" "$package_dir/bin/ffprobe.exe"
strip "$package_dir/bin/ffmpeg.exe" "$package_dir/bin/ffprobe.exe"
cp "$work_dir/ffmpeg-$ffmpeg_version/LICENSE.md" "$package_dir/licenses/FFmpeg-LICENSE.md"
cp "$work_dir/ffmpeg-$ffmpeg_version/COPYING.LGPLv2.1" "$package_dir/licenses/FFmpeg-COPYING.LGPLv2.1"
cp "$work_dir/libvpx-$libvpx_version/LICENSE" "$package_dir/licenses/libvpx-LICENSE"
cp "$work_dir/opus-$opus_version/COPYING" "$package_dir/licenses/Opus-COPYING"

cat >"$build_info" <<EOF
ClipThat bundled FFmpeg build
=============================

Target: Windows 10 or later, x86-64
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
  ./configure --prefix=PREFIX --target=x86_64-win64-gcc --disable-examples --disable-tools --disable-docs --disable-unit-tests --disable-shared --enable-static

Opus configure:
  ./configure --host=x86_64-w64-mingw32 --prefix=PREFIX --disable-shared --enable-static --disable-extra-programs --disable-doc

FFmpeg configure:
  ./configure --prefix=C:/clipthat/ffmpeg --target-os=mingw32 --arch=x86_64 --cc=gcc --disable-gpl --disable-nonfree --disable-doc --disable-debug --disable-ffplay --disable-network --enable-static --disable-shared --enable-libvpx --enable-libopus --enable-mediafoundation --pkg-config-flags=--static --extra-cflags='-I../../prefix/include -I../../prefix/include/opus' --extra-ldflags='-L../../prefix/lib -static -static-libgcc'

Build command:
  npm run build:ffmpeg:win (from an MSYS2 MINGW64 shell)
EOF

cp "$ffmpeg_archive" "$source_contents/"
cp "$libvpx_archive" "$source_contents/"
cp "$opus_archive" "$source_contents/"
cp "$build_info" "$source_contents/BUILD-FFMPEG.txt"
cp "scripts/build-ffmpeg-win.sh" "$source_contents/"
cp -R "$package_dir/licenses" "$source_contents/licenses"
: >"$source_contents/FFmpeg-CHANGES.diff"
(
  cd "$source_contents"
  tar -czf "$source_bundle" .
)

verify_bundled_build || {
  echo "The newly built Windows FFmpeg did not pass ClipThat's codec and license checks." >&2
  exit 1
}

rm -rf "$work_dir" "$prefix"
echo "Built and verified Windows FFmpeg $ffmpeg_version and $source_bundle"
