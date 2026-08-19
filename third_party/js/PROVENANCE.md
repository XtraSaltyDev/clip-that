# JavaScript dependency provenance

ClipThat distributes JavaScript in two forms: production Node modules retained in
`app.asar`, and browser/worker code compiled into renderer assets. `package-lock.json`
pins the exact npm artifacts. `scripts/verify-js-licenses.mjs` checks every package
version and byte-compares the preserved license text with the installed package before
each build.

## Renderer and OCR worker code

| Package             | Version | License    |
| ------------------- | ------: | ---------- |
| React / React DOM   |  18.3.1 | MIT        |
| react-reconciler    |  0.29.2 | MIT        |
| scheduler           |  0.23.2 | MIT        |
| Konva               |  9.3.22 | MIT        |
| react-konva         | 18.2.16 | MIT        |
| Zustand             |  5.0.14 | MIT        |
| bmp-js              |   0.1.0 | MIT        |
| idb-keyval          |   6.3.0 | Apache-2.0 |
| is-electron         |   2.2.2 | MIT        |
| is-url              |   1.2.4 | MIT        |
| node-fetch          |   2.7.0 | MIT        |
| regenerator-runtime | 0.13.11 | MIT        |
| zlibjs              |   0.3.1 | MIT        |

## Production Node modules

| Package              | Version | License       |
| -------------------- | ------: | ------------- |
| electron-updater     |   6.8.9 | MIT           |
| builder-util-runtime |   9.7.0 | MIT           |
| argparse             |   2.0.1 | Python-2.0    |
| debug                |   4.4.3 | MIT           |
| fs-extra             |  10.1.0 | MIT           |
| graceful-fs          |  4.2.11 | ISC           |
| js-yaml              |   4.3.1 | MIT           |
| jsonfile             |   6.2.1 | MIT           |
| jsqr                 |   1.4.0 | Apache-2.0    |
| lazy-val             |   1.0.5 | MIT           |
| lodash.escaperegexp  |   4.1.2 | MIT           |
| lodash.isequal       |   4.5.0 | MIT           |
| ms                   |   2.1.3 | MIT           |
| sax                  |   1.6.1 | BlueOak-1.0.0 |
| semver               |   6.3.1 | ISC           |
| tiny-typed-emitter   |   2.1.0 | MIT           |
| universalify         |   2.0.1 | MIT           |

The `lazy-val` npm archive declares MIT but omits a standalone license file. Its
preserved notice is the MIT notice from the same upstream electron-builder project and
copyright holder. All other files under `licenses/` are byte-exact copies from the named
npm package.
