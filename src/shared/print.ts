/** Escape document metadata before inserting it into the isolated print page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Build a single-page document that contains only the flattened editor capture. */
export function imagePrintHtml(dataUrl: string, title: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      @page { margin: 0; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #fff;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      img {
        display: block;
        width: auto;
        height: auto;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
    </style>
  </head>
  <body><img src="${dataUrl}" alt=""></body>
</html>`
}

/** Electron reports cancellation as a failed print job; keep it out of error UI. */
export function isPrintCancellation(reason: string): boolean {
  return /cancel(?:ed|led)/i.test(reason)
}
