import { createReadStream, promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { parseByteRange } from './byte-range'

const MIME: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.webm': 'video/webm'
}

/** Serve an allowlisted library file with the byte ranges Chromium video playback needs. */
export async function libraryFileResponse(request: Request, filePath: string): Promise<Response> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size <= 0) return new Response('not found', { status: 404 })

  const range = parseByteRange(request.headers.get('range'), stat.size)
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, no-cache',
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  })

  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${stat.size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? stat.size - 1
  headers.set('Content-Length', String(end - start + 1))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })

  const stream = Readable.toWeb(createReadStream(filePath, { start, end }))
  return new Response(stream as BodyInit, { status: range ? 206 : 200, headers })
}
