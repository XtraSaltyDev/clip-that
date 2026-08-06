/**
 * Development-only probe for multi-display capture.
 *
 * Answers, with evidence rather than guesswork: does `desktopCapturer` return a usable
 * frame for every screen, and does it depend on the requested thumbnail size, on timing,
 * or on the display itself? Also checks the `screencapture` CLI, which uses a different
 * capture path entirely.
 *
 *   CLIPTHAT_DIAG_DISPLAYS=1 npm run dev
 */
import { desktopCapturer, screen } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const log = (line: string) => console.log(`[probe] ${line}`)

function run(cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }))
  })
}

async function report(label: string, size: { width: number; height: number }): Promise<void> {
  const started = Date.now()
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: size,
      fetchWindowIcons: false
    })
    const detail = sources
      .map((s) => {
        const t = s.thumbnail
        const sz = t.isEmpty() ? 'EMPTY' : `${t.getSize().width}x${t.getSize().height}`
        return `${s.id}(display_id=${s.display_id || '-'}) → ${sz}`
      })
      .join('  |  ')
    log(`${label} [${size.width}x${size.height}] ${Date.now() - started}ms :: ${detail}`)
  } catch (err) {
    log(`${label} THREW: ${(err as Error).message}`)
  }
}

export async function probeDisplays(): Promise<void> {
  const displays = screen.getAllDisplays()
  log(
    `displays: ${displays
      .map(
        (d) =>
          `id=${d.id} ${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}x ` +
          `origin=${d.bounds.x},${d.bounds.y} rotation=${d.rotation} internal=${(d as { internal?: boolean }).internal}`
      )
      .join('  |  ')}`
  )

  // Does the requested size matter?
  await report('tiny   ', { width: 320, height: 200 })
  await report('720p   ', { width: 1280, height: 720 })
  await report('native3', { width: 2560, height: 1440 })
  await report('bigbox ', { width: 3024, height: 1964 })

  // Does a second back-to-back call degrade?
  await report('repeat1', { width: 3024, height: 1964 })
  await report('repeat2', { width: 3024, height: 1964 })

  // Does waiting help?
  await new Promise((r) => setTimeout(r, 1500))
  await report('delayed', { width: 3024, height: 1964 })

  // The CLI uses a different capture path; -D is 1-based over the active display list.
  for (let i = 1; i <= displays.length; i++) {
    const file = join(tmpdir(), `clipthat-probe-${i}.png`)
    const res = await run('screencapture', ['-x', '-o', '-t', 'png', `-D${i}`, file])
    const stat = await fs.stat(file).catch(() => null)
    log(`screencapture -D${i}: ok=${res.ok} bytes=${stat?.size ?? 0} ${res.error ?? ''}`)
    await fs.rm(file, { force: true }).catch(() => {})
  }

  log('done')
}
