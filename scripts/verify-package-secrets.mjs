#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('Usage: node scripts/verify-package-secrets.mjs <package-directory>')
  process.exit(2)
}

const root = resolve(target)
const forbiddenNames = [
  { name: 'environment file', test: (name) => name === '.env' || name.startsWith('.env.') },
  { name: 'PKCS#12 certificate', test: (name) => /\.(?:p12|pfx)$/i.test(name) },
  {
    name: 'provisioning profile',
    test: (name) => /\.(?:mobileprovision|provisionprofile)$/i.test(name)
  }
]
const credentialPatterns = [
  ['npm access token', /npm_[A-Za-z0-9]{20,}/],
  ['npm authentication setting', /(?:_authToken|_auth)\s*[=:]/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS access key', /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ['Stripe live secret', /sk_live_[A-Za-z0-9]{20,}/]
]

const findings = []

async function inspect(path) {
  const stat = await fs.lstat(path)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(path)) await inspect(`${path}/${entry}`)
    return
  }
  if (!stat.isFile()) return

  const displayPath = relative(root, path) || basename(path)
  for (const rule of forbiddenNames) {
    if (rule.test(basename(path))) findings.push(`${displayPath}: ${rule.name}`)
  }

  // Release contents are comfortably below this limit. Refuse to silently skip a future
  // oversized payload, because that would create a gap in the credential gate.
  if (stat.size > 128 * 1024 * 1024) {
    findings.push(`${displayPath}: file exceeds the credential scanner size limit`)
    return
  }
  const content = (await fs.readFile(path)).toString('latin1')
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(content)) findings.push(`${displayPath}: ${label}`)
  }
}

await inspect(root)

if (findings.length > 0) {
  console.error('Package credential scan failed (values are intentionally omitted):')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log(`Package credential scan passed: ${root}`)
