#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packages = [
  ['react', '18.3.1', 'LICENSE'],
  ['react-dom', '18.3.1', 'LICENSE'],
  ['react-reconciler', '0.29.2', 'LICENSE'],
  ['scheduler', '0.23.2', 'LICENSE'],
  ['konva', '9.3.22', 'LICENSE'],
  ['react-konva', '18.2.16', 'LICENSE'],
  ['zustand', '5.0.14', 'LICENSE'],
  ['bmp-js', '0.1.0', 'LICENSE'],
  ['idb-keyval', '6.3.0', 'LICENCE'],
  ['is-electron', '2.2.2', 'LICENSE'],
  ['is-url', '1.2.4', 'LICENSE-MIT'],
  ['node-fetch', '2.7.0', 'LICENSE.md'],
  ['regenerator-runtime', '0.13.11', 'LICENSE'],
  ['zlibjs', '0.3.1', 'LICENSE'],
  ['argparse', '2.0.1', 'LICENSE'],
  ['builder-util-runtime', '9.7.0', 'LICENSE'],
  ['debug', '4.4.3', 'LICENSE'],
  ['electron-updater', '6.8.9', 'LICENSE'],
  ['fs-extra', '10.1.0', 'LICENSE'],
  ['graceful-fs', '4.2.11', 'LICENSE'],
  ['js-yaml', '4.3.1', 'LICENSE'],
  ['jsonfile', '6.2.1', 'LICENSE'],
  ['jsqr', '1.4.0', 'LICENSE'],
  ['lazy-val', '1.0.5', '../electron-builder/LICENSE'],
  ['lodash.escaperegexp', '4.1.2', 'LICENSE'],
  ['lodash.isequal', '4.5.0', 'LICENSE'],
  ['ms', '2.1.3', 'license.md'],
  ['sax', '1.6.1', 'LICENSE.md'],
  ['semver', '6.3.1', 'LICENSE'],
  ['tiny-typed-emitter', '2.1.0', 'LICENSE'],
  ['universalify', '2.0.1', 'LICENSE']
]

async function required(path, label) {
  const content = await fs.readFile(path).catch(() => null)
  if (!content?.length) throw new Error(`Missing ${label}: ${path}`)
  return content
}

function withoutTerminalNewline(content) {
  if (content.at(-1) !== 0x0a) return content
  return content.subarray(0, content.at(-2) === 0x0d ? -2 : -1)
}

async function verifySource() {
  for (const [name, expectedVersion, licenseName] of packages) {
    const packageDirectory = join(root, 'node_modules', name)
    const metadata = JSON.parse(await fs.readFile(join(packageDirectory, 'package.json'), 'utf8'))
    if (metadata.version !== expectedVersion) {
      throw new Error(`${name} is ${metadata.version}; expected ${expectedVersion}`)
    }
    const upstreamLicense = licenseName.startsWith('../')
      ? join(root, 'node_modules', licenseName.slice(3))
      : join(packageDirectory, licenseName)
    const [upstream, preserved] = await Promise.all([
      required(upstreamLicense, `${name} upstream license`),
      required(join(root, 'third_party/js/licenses', `${name}.txt`), `${name} preserved license`)
    ])
    if (!withoutTerminalNewline(upstream).equals(withoutTerminalNewline(preserved)))
      throw new Error(`${name} preserved license differs from upstream`)
  }
  await required(join(root, 'third_party/js/PROVENANCE.md'), 'JavaScript provenance')
  console.log(`Verified ${packages.length} pinned JavaScript dependency licenses.`)
}

async function verifyPackage(resourcesPath) {
  const directory = join(resourcesPath, 'third-party/js')
  await required(join(directory, 'PROVENANCE.md'), 'packaged JavaScript provenance')
  for (const [name] of packages) {
    const [source, packaged] = await Promise.all([
      required(join(root, 'third_party/js/licenses', `${name}.txt`), `${name} source license`),
      required(join(directory, 'licenses', `${name}.txt`), `${name} packaged license`)
    ])
    if (!source.equals(packaged)) throw new Error(`${name} packaged license differs from source`)
  }
  console.log(`Verified packaged JavaScript dependency licenses: ${resourcesPath}`)
}

const [mode, value] = process.argv.slice(2)
if (mode === '--source' && value === undefined) await verifySource()
else if (mode === '--package' && value) await verifyPackage(resolve(value))
else {
  console.error(
    'Usage: node scripts/verify-js-licenses.mjs --source | --package <app-resources-directory>'
  )
  process.exit(2)
}
