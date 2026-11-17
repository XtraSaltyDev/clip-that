import type { LibraryItem } from './types'

export interface SearchTerm {
  text: string
  exclude: boolean
  field?: 'title' | 'tag' | 'text' | 'type' | 'is' | 'before' | 'after'
}

/** Quoted phrases and excluded words retain the existing AND behavior. */
export function parseLibrarySearch(query: string): SearchTerm[] {
  const terms: SearchTerm[] = []
  const pattern = /(-?)(?:(title|tag|text|type|is|before|after):)?(?:"([^"]*)"|([^\s"]+))/gi
  for (const match of query.matchAll(pattern)) {
    const text = (match[3] ?? match[4]).trim().toLocaleLowerCase()
    if (!text) continue
    const field = match[2]?.toLowerCase() as SearchTerm['field']
    const term: SearchTerm = { text, exclude: match[1] === '-' }
    if (field && validFieldValue(field, text)) term.field = field
    else if (field) term.text = `${field}:${text}`
    terms.push(term)
  }
  return terms
}

function validFieldValue(field: NonNullable<SearchTerm['field']>, text: string): boolean {
  if (field === 'type') return text === 'image' || text === 'video'
  if (field === 'is') return text === 'favorite' || text === 'favourite'
  if (field !== 'before' && field !== 'after') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text
}

const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, ' ')

export function matchesLibrarySearch(text: string, terms: SearchTerm[]): boolean {
  const haystack = normalize(text)
  return terms.every((term) => {
    const found = haystack.includes(normalize(term.text))
    return term.exclude ? !found : found
  })
}

/** OCR text is supplied by main only after its confidence/version checks. */
export function matchesLibraryItemSearch(
  item: Pick<LibraryItem, 'title' | 'tags' | 'kind' | 'favorite' | 'createdAt'>,
  trustedText: string,
  terms: SearchTerm[]
): boolean {
  const haystack = normalize(`${item.title} ${item.tags.join(' ')} ${trustedText}`)
  const date = new Date(item.createdAt)
  const day = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return terms.every((term) => {
    let found: boolean
    switch (term.field) {
      case 'title':
        found = normalize(item.title).includes(normalize(term.text))
        break
      case 'tag':
        found = item.tags.some((tag) => normalize(tag) === normalize(term.text))
        break
      case 'text':
        found = normalize(trustedText).includes(normalize(term.text))
        break
      case 'type':
        found = item.kind === term.text
        break
      case 'is':
        found = item.favorite
        break
      case 'before':
        found = day < term.text
        break
      case 'after':
        found = day >= term.text
        break
      default:
        found = haystack.includes(normalize(term.text))
    }
    return term.exclude ? !found : found
  })
}
