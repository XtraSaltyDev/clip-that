import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const load = (relativePath) =>
  import(pathToFileURL(join(root, '.cache/test', relativePath)).href)
