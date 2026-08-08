#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const sha512 = (path) => createHash('sha512').update(readFileSync(path)).digest('base64')

export function createMacUpdateMetadata({ archivePath, publishedAt, version }) {
  if (!SEMANTIC_VERSION.test(version)) throw new Error('Update version must be semantic.')
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error('Update publication time must be an ISO timestamp.')
  }
  const fileName = `ClipThat-${version}-arm64-mac.zip`
  const file = `releases/${version}/${fileName}`
  const digest = sha512(archivePath)
  const size = statSync(archivePath).size
  if (size <= 0) throw new Error('Update ZIP must not be empty.')
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${digest}`,
    `    size: ${size}`,
    `path: ${file}`,
    `sha512: ${digest}`,
    `releaseDate: '${new Date(publishedAt).toISOString()}'`,
    ''
  ].join('\n')
}

export function verifyMacUpdateFiles({ archivePath, blockmapPath, metadataPath, version }) {
  const metadata = readFileSync(metadataPath, 'utf8')
  const publishedAt = metadata.match(/^releaseDate: '([^']+)'$/m)?.[1]
  if (!publishedAt) throw new Error('latest-mac.yml does not contain a release date.')
  assert.equal(
    metadata,
    createMacUpdateMetadata({ archivePath, publishedAt, version }),
    'latest-mac.yml does not match the exact update ZIP'
  )
  const blockmap = JSON.parse(gunzipSync(readFileSync(blockmapPath)).toString('utf8'))
  assert.equal(blockmap.version, '2', 'ZIP blockmap version is unsupported')
  assert.ok(
    Array.isArray(blockmap.files) &&
      blockmap.files.length > 0 &&
      blockmap.files.every(
        (file) => Array.isArray(file.checksums) && file.checksums.length > 0
      ),
    'ZIP blockmap has no usable block checksums'
  )
}

function argumentsFrom(values) {
  const parsed = new Map()
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith('--') || value === undefined || parsed.has(key)) {
      throw new Error('Arguments must be unique --name value pairs.')
    }
    parsed.set(key, value)
  }
  return (key) => {
    const value = parsed.get(key)
    if (!value) throw new Error(`Missing required argument ${key}.`)
    return value
  }
}

const absolute = (path) => (isAbsolute(path) ? path : resolve(path))

function main() {
  const [command, ...values] = process.argv.slice(2)
  if (command !== 'create' && command !== 'verify') {
    throw new Error('Usage: prepare-mac-update.mjs <create|verify> --name value ...')
  }
  const argument = argumentsFrom(values)
  const inputs = {
    archivePath: absolute(argument('--archive')),
    blockmapPath: absolute(argument('--blockmap')),
    metadataPath: absolute(argument('--metadata')),
    version: argument('--version')
  }
  if (command === 'create') {
    const metadata = createMacUpdateMetadata({
      archivePath: inputs.archivePath,
      publishedAt: argument('--published-at'),
      version: inputs.version
    })
    writeFileSync(inputs.metadataPath, metadata)
  }
  verifyMacUpdateFiles(inputs)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
