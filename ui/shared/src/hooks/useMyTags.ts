import { useEffect, useState } from 'react'
import type { ApiClient } from '../api/client'
import type { Tag } from '../api/types'

/** "我的標籤": loads the tag list and saves each change at once (REQ-008). */
export function useMyTags(api: ApiClient) {
  const [tags, setTags] = useState<Tag[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    api.get<Tag[]>('/tags').then(setTags, () => setError('讀不到標籤清單，請重新整理。'))
  }, [api])

  async function toggle(id: number) {
    const current = tags?.find((t) => t.id === id)
    if (!tags || !current) return
    const flip = (list: Tag[]) => list.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t))
    setTags(flip(tags))
    setError(undefined)
    try {
      await (current.selected ? api.delete(`/me/tags/${id}`) : api.put(`/me/tags/${id}`))
    } catch {
      setTags((list) => (list ? flip(list) : list))
      setError(`「${current.name}」沒有存到，請再試一次。`)
    }
  }

  return { tags, error, toggle }
}
