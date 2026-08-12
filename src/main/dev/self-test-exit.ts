/** Pure exit-status policy so the self-test runner cannot accidentally report failure as success. */
export function selfTestExitCode(results: ReadonlyArray<readonly [string, boolean]>): number {
  return results.length > 0 && results.every(([, passed]) => passed) ? 0 : 1
}
