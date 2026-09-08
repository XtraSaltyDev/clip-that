import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

/** Finish and flush a sibling file before replacing an existing export. */
export async function atomicFileWrite(target: string, contents: string | Buffer): Promise<void> {
  let mode: number | undefined
  let entry
  try {
    entry = await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (entry) {
    // Match ordinary Save behavior for symlinks without replacing the link itself.
    if (entry.isSymbolicLink()) target = await fs.realpath(target)
    const stat = await fs.stat(target)
    if (!stat.isFile()) throw new Error('The save destination is not a regular file')
    await fs.access(target, fs.constants.W_OK)
    mode = stat.mode & 0o777
  }

  const temporary = join(dirname(target), `.clipthat-${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, 'wx', mode)
  try {
    if (mode !== undefined) await handle.chmod(mode)
    await handle.writeFile(contents)
    await handle.sync()
    await handle.close()
    await fs.rename(temporary, target)
  } finally {
    await handle.close().catch(() => {})
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}
