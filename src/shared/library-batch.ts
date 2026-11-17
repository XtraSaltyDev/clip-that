import type { LibraryBatchPatch, LibraryItem } from './types'

/** Compute the complete transaction before the main store attempts a single durable commit. */
export function applyLibraryBatch(
  items: readonly LibraryItem[],
  ids: readonly string[],
  patch: LibraryBatchPatch,
  now = Date.now()
): LibraryItem[] {
  const selected = new Set(ids)
  const active = new Set(items.filter((item) => !item.deletedAt).map((item) => item.id))
  if (!selected.size || [...selected].some((id) => !active.has(id)))
    throw new Error(
      'Some selected captures are no longer available. Refresh the Library and retry.'
    )

  return items.map((item) => {
    if (!selected.has(item.id)) return item
    let tags = item.tags
    if (patch.tag) {
      tags =
        patch.tag.action === 'add'
          ? [...new Set([...tags, patch.tag.value])]
          : tags.filter((tag) => tag !== patch.tag!.value)
      if (tags.length > 50)
        throw new Error(`“${item.title}” already has 50 tags. Remove a tag before adding another.`)
    }
    const favorite = patch.favorite ?? item.favorite
    if (
      favorite === item.favorite &&
      tags.length === item.tags.length &&
      tags.every((tag, index) => tag === item.tags[index])
    )
      return item
    return { ...item, tags: [...tags], favorite, updatedAt: now }
  })
}
