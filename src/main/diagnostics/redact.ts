const MAX_LOG_CHARACTERS = 750_000

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Best-effort removal of user paths, content payloads, network identifiers, and secrets. */
export function redactDiagnosticsText(input: string, sensitivePaths: readonly string[] = []): string {
  let output = input.slice(-MAX_LOG_CHARACTERS).replace(/\0/g, '')

  for (const path of [...sensitivePaths].filter(Boolean).sort((a, b) => b.length - a.length)) {
    output = output.replace(
      new RegExp(`${escapeRegExp(path)}[^\\r\\n]*`, 'gi'),
      '[REDACTED_PATH]'
    )
  }

  return output
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/data:[^;,\s]+(?:;[^,\s]+)*;base64,[a-z0-9+/=]+/gi, '[REDACTED_DATA_URL]')
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, '[REDACTED_TOKEN]')
    .replace(/\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi, 'authorization: [REDACTED_SECRET]')
    .replace(
      /\b(bearer|token|api[_-]?key|secret|password|passwd|cookie)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[REDACTED_SECRET]'
    )
    .replace(/([?&](?:token|key|secret|password|signature|code)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s)\]}]+/gi, '[REDACTED_URL]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]')
    .replace(/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, '[REDACTED_MAC]')
    .replace(/\/Users\/[^\s"')]+/g, '[REDACTED_PATH]')
    .replace(/\/home\/[^\s"')]+/g, '[REDACTED_PATH]')
    .replace(/[a-z]:\\Users\\[^\s"')]+/gi, '[REDACTED_PATH]')
    .replace(/\/private\/var\/folders\/[^\s"')]+/g, '[REDACTED_TEMP_PATH]')
}
