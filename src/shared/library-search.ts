export interface SearchTerm {
  text: string
  exclude: boolean
}

/** Quoted phrases and excluded words; plain words keep the existing AND behavior. */
export function parseLibrarySearch(query: string): SearchTerm[] {
  const terms: SearchTerm[] = []
  const pattern = /(-?)(?:"([^"]*)"|([^\s"]+))/g
  for (const match of query.matchAll(pattern)) {
    const text = (match[2] ?? match[3]).trim().toLocaleLowerCase()
    if (text) terms.push({ text, exclude: match[1] === '-' })
  }
  return terms
}

export function matchesLibrarySearch(text: string, terms: SearchTerm[]): boolean {
  const haystack = text.toLocaleLowerCase().replace(/\s+/g, ' ')
  return terms.every((term) => {
    const found = haystack.includes(term.text.replace(/\s+/g, ' '))
    return term.exclude ? !found : found
  })
}
