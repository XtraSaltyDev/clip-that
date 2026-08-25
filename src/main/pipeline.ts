import { exec } from 'node:child_process'
import type { CaptureResult, Pipeline } from '@shared/types'
import { formatFilename } from '@shared/defaults'
import { settings } from './store/settings'
import { library } from './store/library'
import { copyImageToClipboard, saveImage } from './export'
import { createPin } from './windows/pins'
import { broadcast } from './windows/manager'

export interface PipelineOutcome {
  steps: string[]
  savedPath?: string
  errors: string[]
}

/**
 * Run the user's configured post-capture chain. Steps execute in a fixed, sensible
 * order (save before the command so `{file}` exists; edit last so the editor opens on
 * top of a finished chain), skipping whatever isn't enabled.
 */
export async function runPipeline(
  result: CaptureResult,
  pipeline: Pipeline,
  openEditor: (result: CaptureResult, libraryId?: string) => void,
  existingLibraryId?: string
): Promise<PipelineOutcome> {
  const outcome: PipelineOutcome = { steps: [], errors: [] }
  const s = settings.get()
  const title = result.title || formatFilename(s.filenameTemplate)

  // Every pipeline capture lands in the library regardless of steps — nothing is ever lost.
  // A handoff action may be rerunning the pipeline for an item already indexed by Quick Access.
  const existing = existingLibraryId ? library.get(existingLibraryId) : undefined
  const item =
    existing?.kind === 'image'
      ? existing
      : await library.addImage({
          dataUrl: result.dataUrl,
          title,
          width: result.width,
          height: result.height
        })

  if (pipeline.save) {
    const saved = await saveImage({
      dataUrl: result.dataUrl,
      format: s.imageFormat,
      suggestedName: title
    })
    if (saved.ok && saved.filePath) {
      outcome.savedPath = saved.filePath
      outcome.steps.push('save')
    } else if (!saved.canceled) {
      outcome.errors.push(`save: ${saved.error ?? 'failed'}`)
    }
  }

  if (pipeline.copy) {
    if (copyImageToClipboard(result.dataUrl)) outcome.steps.push('copy')
    else outcome.errors.push('copy: clipboard rejected the image')
  }

  if (pipeline.pin) {
    if (createPin(result.dataUrl, { scaleFactor: result.scaleFactor })) outcome.steps.push('pin')
    else outcome.errors.push('pin: image did not decode')
  }

  if (pipeline.command.trim()) {
    // The command needs a file; fall back to the library copy when save is off.
    const file = outcome.savedPath ?? item.filePath
    const cmd = pipeline.command.replaceAll('{file}', shellQuote(file))
    try {
      await new Promise<void>((resolve, reject) => {
        exec(cmd, { timeout: 30_000 }, (err, _stdout, stderr) =>
          err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve()
        )
      })
      outcome.steps.push('command')
    } catch (err) {
      outcome.errors.push(`command: ${(err as Error).message}`)
    }
  }

  if (pipeline.edit) {
    openEditor(result, item.id)
    outcome.steps.push('edit')
  }

  const summary =
    outcome.steps.length > 0
      ? `Pipeline: ${outcome.steps.join(' → ')}`
      : 'Pipeline ran (no steps enabled)'
  broadcast('system:toast', {
    kind: outcome.errors.length ? 'error' : 'success',
    message: outcome.errors.length ? 'Pipeline finished with errors' : summary,
    detail: outcome.errors.join('; ') || outcome.savedPath
  })
  console.log(
    `[clipthat] ${summary}${outcome.errors.length ? ` — errors: ${outcome.errors.join('; ')}` : ''}`
  )
  return outcome
}

/** Single-quote a path for /bin/sh, the only safe way to hand it to a user command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
