# Third-party notices

ClipThat's Apple-silicon macOS release includes the native media components and bundled
JavaScript dependencies below. The packaged app contains their license texts and build record at
`Contents/Resources/third-party/ffmpeg/`. Every binary release must also carry
`ClipThat-<version>-third-party-sources.tar.gz` on the same distribution server.

## FFmpeg 9.0.1

- Project: <https://ffmpeg.org/>
- Source: <https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz>
- License mode: GNU Lesser General Public License, version 2.1 or later
- ClipThat configuration: `--disable-gpl --disable-nonfree`
- Source modifications: none

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. ClipThat is not
endorsed by or affiliated with the FFmpeg project.

## libvpx 1.16.0

- Project: <https://chromium.googlesource.com/webm/libvpx/>
- Source: <https://storage.googleapis.com/downloads.webmproject.org/releases/webm/libvpx-1.16.0.tar.gz>
- License: BSD 3-Clause
- Source modifications: none

## Opus 1.6.1

- Project: <https://opus-codec.org/>
- Source: <https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz>
- License: BSD 3-Clause
- Source modifications: none

The exact source archive hashes and complete configure commands are recorded in
`BUILD-FFMPEG.txt`, both inside the app and in the corresponding-source archive.

## Tesseract.js 5.1.1 and Tesseract.js Core 5.1.1

- Projects: <https://github.com/naptha/tesseract.js/tree/v5.1.1> and
  <https://github.com/naptha/tesseract.js-core/tree/v5.1.1>
- License: Apache License 2.0
- Source modifications: none

ClipThat bundles the upstream Tesseract.js worker and Tesseract.js Core WebAssembly files for
offline OCR. Their exact package paths and SHA-256 hashes are recorded in
`third_party/ocr/PROVENANCE.md`. The WebAssembly build contains pinned giflib, Leptonica,
libjpeg, libpng, libtiff, libwebp, openlibm, Tesseract and zlib revisions. Their original
license and copyright notices accompany the app under `third-party/ocr/licenses/`.

## Tesseract English language data

- Project revision:
  <https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc>
- Artifact: `4.0.0_best_int/eng.traineddata.gz`
- License: Apache License 2.0
- Source modifications: none

The packaged app includes the Apache-2.0 license and full OCR provenance record at
`Contents/Resources/third-party/ocr/`.

## JavaScript dependencies

The exact versions, license identifiers, provenance notes, and preserved license texts for
renderer, OCR-worker, and production Node dependencies are shipped at
`Contents/Resources/third-party/js/`. The authoritative inventory is
`third_party/js/PROVENANCE.md`; `package-lock.json` pins the corresponding npm artifacts.
