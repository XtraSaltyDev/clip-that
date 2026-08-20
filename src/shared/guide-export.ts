import type { GuideDocument } from './types'
import { escapeHtml, markdownText } from './guides'

function stepImage(step: GuideDocument['steps'][number]): string {
  return step.renderedImage ?? step.image
}

export function buildGuideMarkdown(guide: GuideDocument, assetsName: string): string {
  const relativeAssetsName = encodeURIComponent(assetsName)
  const lines = [`# ${markdownText(guide.title)}`, '']
  if (guide.description) lines.push(markdownText(guide.description), '')
  guide.steps.forEach((step, index) => {
    const number = index + 1
    lines.push(`## ${number}. ${markdownText(step.title || `Step ${number}`)}`, '')
    if (step.description) lines.push(markdownText(step.description), '')
    lines.push(
      `![Step ${number}: ${markdownText(step.title)}](./${relativeAssetsName}/step-${String(number).padStart(2, '0')}.png)`,
      ''
    )
  })
  return `${lines.join('\n').trim()}\n`
}

export function buildGuideHtml(guide: GuideDocument): string {
  const steps = guide.steps
    .map((step, index) => {
      const number = index + 1
      return `<article class="step" aria-labelledby="step-${number}-title">
  <div class="step-number" aria-hidden="true">${number}</div>
  <div class="step-body">
    <h2 id="step-${number}-title">${escapeHtml(step.title || `Step ${number}`)}</h2>
    ${step.description ? `<p>${escapeHtml(step.description).replace(/\n/g, '<br>')}</p>` : ''}
    <img src="${stepImage(step)}" alt="Step ${number}: ${escapeHtml(step.title)}">
  </div>
</article>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(guide.title)}</title><style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#172033;background:#fff}
*{box-sizing:border-box}body{margin:0}.guide{width:min(960px,calc(100% - 32px));margin:48px auto}.guide>header{margin-bottom:36px}
h1{font-size:clamp(30px,5vw,48px);line-height:1.08;margin:0 0 12px}h2{font-size:22px;margin:0 0 8px}p{color:#465269;line-height:1.6;margin:0 0 18px;white-space:normal}
.step{display:grid;grid-template-columns:42px minmax(0,1fr);gap:18px;margin:0 0 44px;break-inside:avoid}.step-number{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#2563eb;color:white;font-weight:700}
img{display:block;max-width:100%;height:auto;border:1px solid #dce2ea;border-radius:12px;box-shadow:0 10px 30px #17203318}
@media(max-width:560px){.guide{margin:24px auto}.step{grid-template-columns:32px minmax(0,1fr);gap:10px}.step-number{width:30px;height:30px}}
@media print{@page{size:A4;margin:14mm}.guide{width:auto;margin:0}.guide>header{break-after:page}.step{display:block;break-after:page;margin:0}.step:last-child{break-after:auto}.step-number{margin-bottom:10px}img{max-height:215mm;object-fit:contain;box-shadow:none}}
</style></head><body><main class="guide"><header><h1>${escapeHtml(guide.title)}</h1>${guide.description ? `<p>${escapeHtml(guide.description).replace(/\n/g, '<br>')}</p>` : ''}</header>${steps}</main></body></html>`
}
