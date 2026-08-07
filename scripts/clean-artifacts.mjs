#!/usr/bin/env node

/**
 * Remove generated build trees and delivery files from older versions while keeping
 * the current version's finished release packages. Dependencies and user data are
 * deliberately outside this script's scope.
 */
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
const versionPrefix = `ClipThat-${pkg.version}-`
const dryRun = process.argv.includes('--dry-run')

function isCurrentDeliveryFile(name) {
  if (!name.startsWith(versionPrefix) || name.endsWith('.blockmap')) return false
  return /\.(?:dmg|zip|exe|AppImage|deb|rpm|txt)$/i.test(name)
}

function isGeneratedDistFile(name) {
  return (
    name.startsWith('ClipThat-') ||
    name.startsWith('builder-') ||
    name === '.DS_Store'
  )
}

async function pathSize(path) {
  const stat = await fs.lstat(path)
  if (!stat.isDirectory()) return stat.size
  const entries = await fs.readdir(path)
  let total = 0
  for (const entry of entries) total += await pathSize(join(path, entry))
  return total
}

const targets = []

for (const path of [join(root, 'out'), join(root, '.cache')]) {
  if (await fs.lstat(path).catch(() => null)) targets.push(path)
}

const distEntries = await fs.readdir(dist, { withFileTypes: true }).catch(() => [])
for (const entry of distEntries) {
  const path = join(dist, entry.name)
  if (entry.isDirectory()) {
    // Electron Builder's expanded app/icon directories are staging data. A formal
    // release is represented by its signed delivery files, not these duplicates.
    targets.push(path)
  } else if (isGeneratedDistFile(entry.name) && !isCurrentDeliveryFile(entry.name)) {
    targets.push(path)
  }
}

let bytes = 0
for (const target of targets) {
  bytes += await pathSize(target)
  console.log(`${dryRun ? 'would remove' : 'removed'} ${target.slice(root.length + 1)}`)
  if (!dryRun) await fs.rm(target, { recursive: true, force: true })
}

const mib = (bytes / 1024 / 1024).toFixed(1)
console.log(`${dryRun ? 'Would reclaim' : 'Reclaimed'} ${mib} MiB; kept current ${pkg.version} delivery artifacts.`)
