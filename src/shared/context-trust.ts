import type { OcrResult } from './types'
import type { OcrAssessment } from './ocr-quality'

export type ContextTrustState =
  'processing' | 'trusted' | 'partial' | 'uncertain' | 'empty' | 'failure'

export interface ContextTrustSummary {
  state: ContextTrustState
  label: string
  detail: string
  structuredActionsAllowed: boolean
  structuredActionReason: string
  recoveredWords: number
  uncertainWords: number
  trustedText: string
  rawText: string
}

export interface ContextTrustInput {
  busy: boolean
  assessment: OcrAssessment | null
  raw: OcrResult | null
  error?: string | null
}

/**
 * Turn the existing OCR assessment into the small set of honest states shown by
 * Screen Context. Numeric confidence is intentionally not exposed here: the
 * quality rules provide a calibrated boundary, not a user-facing probability.
 */
export function summarizeContextTrust(input: ContextTrustInput): ContextTrustSummary {
  const assessment = input.assessment
  const rawText = input.raw?.text.trim() ?? ''
  const trustedText = assessment?.trusted.text.trim() ?? ''
  const recoveredWords = assessment?.trusted.words.length ?? 0
  const uncertainWords = assessment?.rejectedWords ?? 0

  if (input.busy) {
    return summary(
      'processing',
      'Context is processing',
      'You can still edit, save, copy, or keep the original capture while reading finishes.',
      false,
      'Structured actions will be available only after the text passes the current trust checks.'
    )
  }

  if (input.error) {
    return summary(
      'failure',
      'Context unavailable',
      `The capture is preserved. ${input.error}`,
      false,
      'Retry Context or use the original capture and regular editor actions instead.'
    )
  }

  if (!assessment || (!rawText && recoveredWords === 0)) {
    return summary(
      'empty',
      'No text recovered',
      'The original capture is preserved, but Context did not return text to verify.',
      false,
      'Retry Context or continue with the original capture and editor actions.'
    )
  }

  if (assessment.disposition === 'accepted') {
    return summary(
      'trusted',
      'Trusted text',
      'All recovered text passed the current OCR quality checks and can power Context actions.',
      true,
      ''
    )
  }

  if (assessment.disposition === 'mixed') {
    return summary(
      'partial',
      'Partial result',
      `Recovered ${recoveredWords} word${recoveredWords === 1 ? '' : 's'}; ${uncertainWords} word${uncertainWords === 1 ? '' : 's'} could not be verified.`,
      false,
      'Structured actions are unavailable until the full result passes the trust checks. You can still copy trusted or raw text.'
    )
  }

  return summary(
    'uncertain',
    'Uncertain text',
    'No recovered text passed the current trust checks. Raw OCR is available for inspection only.',
    false,
    'Structured actions are unavailable because the result is not verified. Copy raw text or use the original capture instead.'
  )

  function summary(
    state: ContextTrustState,
    label: string,
    detail: string,
    structuredActionsAllowed: boolean,
    structuredActionReason: string
  ): ContextTrustSummary {
    return {
      state,
      label,
      detail,
      structuredActionsAllowed,
      structuredActionReason,
      recoveredWords,
      uncertainWords,
      trustedText,
      rawText
    }
  }
}
