import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native', 'window-info.swift')
const output = join(root, 'build', 'clipthat-window-info')

mkdirSync(dirname(output), { recursive: true })
execFileSync('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', output], { stdio: 'inherit' })
chmodSync(output, 0o755)
console.log(`built ${output}`)
