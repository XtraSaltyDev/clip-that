import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const r = (...p: string[]) => resolve(__dirname, ...p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: r('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': r('src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: r('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: r('src/renderer'),
    resolve: {
      alias: {
        '@shared': r('src/shared'),
        '@': r('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          editor: r('src/renderer/editor.html'),
          overlay: r('src/renderer/overlay.html'),
          library: r('src/renderer/library.html'),
          hud: r('src/renderer/hud.html'),
          settings: r('src/renderer/settings.html')
        }
      }
    }
  }
})
