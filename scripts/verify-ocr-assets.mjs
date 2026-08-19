#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { extractFile } from '@electron/asar'

const root = resolve(import.meta.dirname, '..')
const assets = [
  {
    name: 'eng.traineddata.gz',
    sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
    source:
      'https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_best_int/eng.traineddata.gz'
  },
  {
    name: 'worker.min.js',
    sha256: 'aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc',
    upstream: 'node_modules/tesseract.js/dist/worker.min.js'
  },
  {
    name: 'tesseract-core-lstm.wasm',
    sha256: '5db58ea4d1bd4256be81e8ae3b4fa226c4625dfba1850b1b3308dbf3700e9929',
    upstream: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm'
  },
  {
    name: 'tesseract-core-lstm.wasm.js',
    sha256: '8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa',
    upstream: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'
  },
  {
    name: 'tesseract-core-simd-lstm.wasm',
    sha256: '66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef',
    upstream: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm'
  },
  {
    name: 'tesseract-core-simd-lstm.wasm.js',
    sha256: 'ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf',
    upstream: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'
  }
]
const licenseFiles = [
  ['Apache-2.0.txt', 'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1'],
  [
    'licenses/giflib-COPYING.txt',
    '0c9b7990ecdca88b676db232c226548ac408b279f550d424d996f0d83591dd8e'
  ],
  [
    'licenses/leptonica-license.txt',
    '87829abb5bbb00b55a107365da89e9a33f86c4250169e5a1e5588505be7d5806'
  ],
  [
    'licenses/libjpeg-README-license.txt',
    'c791da525733040e622ed257c7b096b8f5191b332604ead0c6bc2b54cbd8e0d1'
  ],
  [
    'licenses/libpng-LICENSE.txt',
    '33ba4e187d8b0c8d7ab2bc2e522bb095219e03089e9aa0122b4fb9eb2b7de82b'
  ],
  [
    'licenses/libtiff-COPYRIGHT.txt',
    'fbd6fed7938541d2c809c0826225fc85e551fdbfa8732b10f0c87e0847acafd7'
  ],
  [
    'licenses/libwebp-COPYING.txt',
    '5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf'
  ],
  [
    'licenses/openlibm-LICENSE.md',
    'b1843fbf5b03f519a5f0a44fce751bdd1022ae7148614923f9d6293e17a18b17'
  ],
  [
    'licenses/zlib-README-license.txt',
    'fc2c3368901700f0acdeb1d8afeaca5923296768ec6824ecdf627aac396001fd'
  ]
]

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function verifyDigest(asset, buffer, location) {
  const actual = digest(buffer)
  if (actual !== asset.sha256) {
    throw new Error(`${location} has SHA-256 ${actual}; expected ${asset.sha256}`)
  }
}

async function verifyLicenses(directory) {
  for (const [name, sha256] of licenseFiles) {
    const path = join(directory, name)
    const content = await fs.readFile(path).catch(() => null)
    if (!content) throw new Error(`Missing OCR license file: ${path}`)
    const actual = digest(content)
    if (actual !== sha256) throw new Error(`${path} has SHA-256 ${actual}; expected ${sha256}`)
  }
  const provenance = await fs.stat(join(directory, 'PROVENANCE.md')).catch(() => null)
  if (!provenance?.isFile() || provenance.size === 0) {
    throw new Error(`Missing OCR provenance file: ${join(directory, 'PROVENANCE.md')}`)
  }
}

async function verifySource() {
  for (const asset of assets) {
    const bundledPath = join(root, 'src/renderer/public/ocr', asset.name)
    const bundled = await fs.readFile(bundledPath)
    verifyDigest(asset, bundled, bundledPath)
    if (asset.upstream) {
      const upstreamPath = join(root, asset.upstream)
      const upstream = await fs.readFile(upstreamPath)
      verifyDigest(asset, upstream, upstreamPath)
      if (!bundled.equals(upstream)) {
        throw new Error(`${bundledPath} differs from ${upstreamPath}`)
      }
    }
  }
  await verifyLicenses(join(root, 'third_party/ocr'))
  console.log('Verified pinned OCR assets and installed package artifacts.')
}

async function verifyPackage(resourcesPath) {
  const asarPath = join(resourcesPath, 'app.asar')
  for (const asset of assets) {
    const packaged = extractFile(asarPath, `out/renderer/ocr/${asset.name}`)
    verifyDigest(asset, packaged, `${asarPath}:out/renderer/ocr/${asset.name}`)
  }
  await verifyLicenses(join(resourcesPath, 'third-party/ocr'))
  console.log(`Verified packaged OCR assets and licenses: ${resourcesPath}`)
}

const [mode, value] = process.argv.slice(2)
if (mode === '--source' && value === undefined) await verifySource()
else if (mode === '--package' && value) await verifyPackage(resolve(value))
else {
  console.error(
    'Usage: node scripts/verify-ocr-assets.mjs --source | --package <app-resources-directory>'
  )
  process.exit(2)
}
