import { promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** True only when candidate is the root itself or a lexical child of it. */
export function isPathInside(root: string, candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

/** Resolve symlinks before allowing a file to be read or served. */
export async function isRealPathInside(root: string, candidate: string): Promise<boolean> {
  if (!isPathInside(root, candidate)) return false
  try {
    const [realRoot, realCandidate] = await Promise.all([fs.realpath(root), fs.realpath(candidate)])
    return isPathInside(realRoot, realCandidate)
  } catch {
    return false
  }
}
