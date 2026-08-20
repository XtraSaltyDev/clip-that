import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export async function atomicGuideWrite(target: string, contents: string | Buffer): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, contents)
  try {
    await fs.rename(temporary, target)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export async function readGuideJsonWithBackup<T>(
  primary: string,
  backup: string,
  parse: (value: unknown) => T
): Promise<{ value: T; recovered: boolean }> {
  try {
    return { value: parse(JSON.parse(await fs.readFile(primary, 'utf8'))), recovered: false }
  } catch (primaryError) {
    try {
      return { value: parse(JSON.parse(await fs.readFile(backup, 'utf8'))), recovered: true }
    } catch {
      throw primaryError
    }
  }
}
