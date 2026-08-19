const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

interface SemanticVersion {
  core: [number, number, number]
  prerelease: Array<number | string> | null
}

function semanticVersion(value: unknown, label = 'version'): SemanticVersion {
  if (typeof value !== 'string' || value.length > 64) {
    throw new TypeError(`${label} must be a semantic version`)
  }
  const match = SEMVER.exec(value)
  if (!match) throw new TypeError(`${label} must be a semantic version`)

  const core = match.slice(1, 4).map((part) => Number(part))
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw new TypeError(`${label} is outside the supported range`)
  }

  const prerelease = match[4]
    ? match[4].split('.').map((part) => {
        if (!/^\d+$/.test(part)) return part
        if (part.length > 1 && part.startsWith('0')) {
          throw new TypeError(`${label} has an invalid prerelease identifier`)
        }
        const numeric = Number(part)
        if (!Number.isSafeInteger(numeric)) {
          throw new TypeError(`${label} is outside the supported range`)
        }
        return numeric
      })
    : null

  return { core: core as [number, number, number], prerelease }
}

/** Compare two semantic versions using SemVer precedence. */
export function compareSemanticVersions(left: string, right: string): number {
  const a = semanticVersion(left, 'left version')
  const b = semanticVersion(right, 'right version')

  for (let index = 0; index < a.core.length; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }

  if (a.prerelease === null && b.prerelease === null) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1

  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'string') return -1
    if (typeof leftPart === 'string' && typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}
