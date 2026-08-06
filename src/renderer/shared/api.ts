import type { ClipThatApi } from '../../preload'

declare global {
  interface Window {
    clipthat: ClipThatApi
  }
}

export const api = window.clipthat

export type { ClipThatApi }
