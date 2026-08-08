import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from './helpers.mjs'

const { redactDiagnosticsText } = await load('diagnosticsRedact')

test('diagnostics logs redact user paths, payloads, network identifiers and secrets', () => {
  const raw = [
    'saved /Users/alice/Pictures/Client merger/board.png',
    'contact alice@example.com from 192.168.1.42',
    'authorization: Bearer top-secret-value',
    'image data:image/png;base64,AAAAAA',
    'request https://internal.example.test/path?token=secret'
  ].join('\n')

  const redacted = redactDiagnosticsText(raw, ['/Users/alice/Pictures/Client merger'])

  assert.doesNotMatch(redacted, /alice|board\.png|192\.168\.1\.42|top-secret-value|AAAAAA|internal\.example/)
  assert.match(redacted, /REDACTED_PATH/)
  assert.match(redacted, /REDACTED_SECRET/)
  assert.match(redacted, /REDACTED_DATA_URL/)
  assert.match(redacted, /REDACTED_URL/)
})
