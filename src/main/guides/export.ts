import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import type { GuideDocument, GuideExportFormat, GuideExportResult } from '@shared/types'
import { buildGuideHtml, buildGuideMarkdown } from '@shared/guide-export'
import { safeFilename } from '@shared/defaults'
import { settings } from '../store/settings'

function stepImage(step: GuideDocument['steps'][number]): string {
  return step.renderedImage ?? step.image
}

function imageBytes(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new TypeError('Guide image is invalid')
  return Buffer.from(dataUrl.slice(comma + 1), 'base64')
}

export async function exportGuide(
  guide: GuideDocument,
  format: GuideExportFormat
): Promise<GuideExportResult> {
  const extension = format === 'markdown' ? 'md' : format
  const name = safeFilename(guide.title, 'ClipThat Guide')
  const acceptanceDirectory =
    process.env['CLIPTHAT_ACCEPTANCE_PROFILE'] === '1'
      ? process.env['CLIPTHAT_ACCEPTANCE_EXPORT_DIR']
      : undefined
  let target: string
  if (acceptanceDirectory) {
    if (!isAbsolute(acceptanceDirectory)) {
      return { ok: false, error: 'Acceptance export directory must be absolute', format }
    }
    await fs.mkdir(acceptanceDirectory, { recursive: true })
    target = join(acceptanceDirectory, `${name}.${extension}`)
  } else {
    const response = await dialog.showSaveDialog({
      title: `Export guide as ${format === 'markdown' ? 'Markdown' : format.toUpperCase()}`,
      defaultPath: join(settings.get().saveDirectory, `${name}.${extension}`),
      filters: [
        {
          name: `${format === 'markdown' ? 'Markdown' : format.toUpperCase()} guide`,
          extensions: [extension]
        }
      ]
    })
    if (response.canceled || !response.filePath) return { ok: false, canceled: true, format }
    target = response.filePath
  }

  try {
    if (format === 'markdown') {
      const targetName = basename(target, extname(target))
      const assetsName = `${targetName}-assets`
      const assetsDirectory = join(dirname(target), assetsName)
      await fs.mkdir(assetsDirectory, { recursive: true })
      await Promise.all(
        guide.steps.map((step, index) =>
          fs.writeFile(
            join(assetsDirectory, `step-${String(index + 1).padStart(2, '0')}.png`),
            imageBytes(stepImage(step))
          )
        )
      )
      await fs.writeFile(target, buildGuideMarkdown(guide, assetsName), 'utf8')
      return { ok: true, filePath: target, assetsDirectory, format }
    }

    const html = buildGuideHtml(guide)
    if (format === 'html') {
      await fs.writeFile(target, html, 'utf8')
      return { ok: true, filePath: target, format }
    }

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        preferCSSPageSize: true
      })
      await fs.writeFile(target, pdf)
    } finally {
      if (!win.isDestroyed()) win.destroy()
    }
    return { ok: true, filePath: target, format }
  } catch (error) {
    return { ok: false, error: (error as Error).message, format }
  }
}
