import test from 'node:test'
import assert from 'node:assert/strict'
import QRCode from 'qrcode'
import { PNG } from 'pngjs'
import { load } from './helpers.mjs'

const { decodeQrRgba, looksLikeUrl } = await load('qr')

/** Render a QR to raw RGBA via qrcode → pngjs, the same pixel layout a canvas gives us. */
async function qrPixels(text, width = 300) {
  const buffer = await QRCode.toBuffer(text, { width, margin: 2 })
  const png = PNG.sync.read(buffer)
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height }
}

test('round-trips a URL through encode → decode', async () => {
  const { data, width, height } = await qrPixels('https://clipthat.dev/context?id=42')
  assert.equal(decodeQrRgba(data, width, height), 'https://clipthat.dev/context?id=42')
})

test('round-trips plain text and wifi-style payloads', async () => {
  for (const payload of ['hello from a screenshot', 'WIFI:T:WPA;S:Studio;P:hunter2;;']) {
    const { data, width, height } = await qrPixels(payload)
    assert.equal(decodeQrRgba(data, width, height), payload)
  }
})

test('returns null for an image with no QR in it', async () => {
  const width = 200
  const height = 200
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 251
    data[i + 1] = 128
    data[i + 2] = 64
    data[i + 3] = 255
  }
  assert.equal(decodeQrRgba(data, width, height), null)
})

test('looksLikeUrl distinguishes links from prose', () => {
  assert.ok(looksLikeUrl('https://example.com/x'))
  assert.ok(looksLikeUrl('www.example.com/pricing'))
  assert.ok(!looksLikeUrl('hello world'))
  assert.ok(!looksLikeUrl('WIFI:T:WPA;S:Studio;;'))
})
