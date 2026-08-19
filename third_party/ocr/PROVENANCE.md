# OCR asset provenance

ClipThat bundles the following unmodified artifacts for offline OCR. `npm ci` installs the
exact packages from `package-lock.json`; `npm run verify:ocr-assets` requires every committed
asset to match its package source and pinned SHA-256 digest byte-for-byte.

| Bundled artifact                   | Upstream package artifact                                   | SHA-256                                                            |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `eng.traineddata.gz`               | `naptha/tessdata@806cd9a/4.0.0_best_int/eng.traineddata.gz` | `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91` |
| `worker.min.js`                    | `tesseract.js@5.1.1/dist/worker.min.js`                     | `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc` |
| `tesseract-core-lstm.wasm`         | `tesseract.js-core@5.1.1/tesseract-core-lstm.wasm`          | `5db58ea4d1bd4256be81e8ae3b4fa226c4625dfba1850b1b3308dbf3700e9929` |
| `tesseract-core-lstm.wasm.js`      | `tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js`       | `8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa` |
| `tesseract-core-simd-lstm.wasm`    | `tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm`     | `66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef` |
| `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js`  | `ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf` |

Sources:

- <https://github.com/naptha/tesseract.js/tree/v5.1.1>
- <https://github.com/naptha/tesseract.js-core/tree/v5.1.1>
- <https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc>

The files are unmodified. Tesseract.js, Tesseract.js Core and the pinned language-data
repository revision are Apache-2.0. The corresponding license text is in this directory.

## Tesseract.js Core compiled dependencies

The WebAssembly files match `tesseract.js-core@5.1.1`, built from commit
`027867a5ab2e2e5b3736757b199b39e07706cf99`. That source revision pins these compiled
submodules; their original license or copyright files are preserved under `licenses/`.

| Component | Pinned revision                            | Preserved notice             |
| --------- | ------------------------------------------ | ---------------------------- |
| giflib    | `fa37672085ce4b3d62c51627ab3c8cf2dda8009a` | `giflib-COPYING.txt`         |
| Leptonica | `4af068b56a9674da915debea4ed7e1b9885b17e8` | `leptonica-license.txt`      |
| libjpeg   | `6c0fcb8ddee365e7abc4d332662b06900612e923` | `libjpeg-README-license.txt` |
| libpng    | `a37d4836519517bdce6cb9d956092321eca3e73b` | `libpng-LICENSE.txt`         |
| libtiff   | `b51bb157123264e26d34c09cc673d213aea61fc7` | `libtiff-COPYRIGHT.txt`      |
| libwebp   | `20ef03ee351d4ff03c5ff3ec4804a879d1b9d5c`  | `libwebp-COPYING.txt`        |
| openlibm  | `ae2d91698508701c83cab83714d42a1146dccf85` | `openlibm-LICENSE.md`        |
| Tesseract | `e20b1c6553c8f68c4bbff1feef0a64064959a427` | `../Apache-2.0.txt`          |
| zlib      | `21767c654d31d2dccdde4330529775c6c5fd5389` | `zlib-README-license.txt`    |

Source tree: <https://github.com/naptha/tesseract.js-core/tree/027867a5ab2e2e5b3736757b199b39e07706cf99>
