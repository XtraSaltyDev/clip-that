/**
 * Bundles the pure modules under test into plain ESM so `node --test` can import them
 * without Electron, Vite or a TypeScript loader in the way.
 *
 * Only modules with no runtime dependency on Electron or the DOM belong here.
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, '.cache/test')

const ENTRIES = {
  extract: 'src/renderer/shared/extract.ts',
  defaults: 'src/shared/defaults.ts',
  stitch: 'src/main/capture/stitch-core.ts',
  layout: 'src/renderer/editor/layout.ts',
  camera: 'src/renderer/hud/zoom-camera.ts',
  recordingSources: 'src/renderer/hud/recording-sources.ts',
  qr: 'src/renderer/shared/qr.ts',
  libraryOpenPolicy: 'src/main/library/open-policy.ts',
  windowSources: 'src/main/capture/window-sources.ts',
  ipcValidation: 'src/main/ipc/validation.ts',
  pathGuard: 'src/main/store/path-guard.ts',
  recordingRecovery: 'src/main/recording/recovery-store.ts',
  libraryIndex: 'src/main/store/library-index.ts',
  editorStore: 'src/renderer/editor/store.ts',
  tilt: 'src/renderer/editor/canvas/tilt.ts',
  transforms: 'src/renderer/editor/canvas/transforms.ts',
  diagnosticsRedact: 'src/main/diagnostics/redact.ts',
  updateContract: 'src/main/update/contract.ts',
  updateMetadata: 'src/main/update/metadata.ts',
  updateTrust: 'src/main/update/trust.ts',
  byteRange: 'src/main/protocol/byte-range.ts',
  releaseNotes: 'src/shared/release-notes.ts',
  snagitCore: 'src/main/import/snagit-core.ts'
}

rmSync(outdir, { recursive: true, force: true })

await build({
  entryPoints: Object.fromEntries(
    Object.entries(ENTRIES).map(([name, file]) => [name, join(root, file)])
  ),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outdir,
  logLevel: 'warning',
  alias: { '@shared': join(root, 'src/shared') }
})

// Mark the output as ESM so Node doesn't re-parse each file to work it out.
mkdirSync(outdir, { recursive: true })
writeFileSync(join(outdir, 'package.json'), '{"type":"module"}\n')

console.log(`built ${Object.keys(ENTRIES).length} test modules → .cache/test`)
