import { useEffect, useState } from 'react'
import { requestPreview } from '../previewRequests'
import type { LibraryItem } from '../types'

const unavailable: Record<Exclude<LibraryItem['availability'], 'available'>, string> = {
  missing: '副本已丢失，无法读取图片。', changed: '副本已变化，无法读取图片。', unverified: '副本没有可信凭据，无法读取图片。',
}

function VerifiedImage({ workspaceId, item }: { workspaceId: string; item: LibraryItem }) {
  const identity = `${workspaceId}:${item.id}:${item.availability}`
  const [loaded, setLoaded] = useState<{ identity: string; image?: string; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (item.availability === 'available') requestPreview(`/workspaces/${encodeURIComponent(workspaceId)}/library/${encodeURIComponent(item.id)}/preview`, controller.signal)
      .then(preview => {
        if (controller.signal.aborted) return
        const image = preview.image && /^data:image\/(?:png|jpeg|webp);base64,/.test(preview.image) ? preview.image : undefined
        setLoaded({ identity, image })
      })
      .catch(reason => { if (!controller.signal.aborted) setLoaded({ identity, error: reason instanceof Error ? reason.message : '图片读取失败。' }) })
    return () => controller.abort()
  }, [workspaceId, item.id, item.availability, identity])
  const current = loaded?.identity === identity ? loaded : null
  return <figure className="graph-evidence-image"><figcaption>{item.name}</figcaption><div aria-busy={item.availability === 'available' && !current}>{item.availability !== 'available' ? <p>{unavailable[item.availability]}</p> : current?.error ? <p role="alert">{current.error}</p> : !current ? <p>正在核验并读取图片…</p> : current.image ? <img src={current.image} alt={`${item.name} 的关系依据图片`} /> : <p>此副本没有可显示的安全图片预览。</p>}</div></figure>
}

export function GraphImageEvidence({ workspaceId, relationId, source, target }: { workspaceId: string; relationId: string; source: LibraryItem; target: LibraryItem }) {
  return <section className="graph-image-evidence" aria-label="双方图片对照" key={`${workspaceId}:${relationId}`}><h4>双方图片对照</h4><div><VerifiedImage key={`${workspaceId}:${relationId}:${source.id}`} workspaceId={workspaceId} item={source} /><VerifiedImage key={`${workspaceId}:${relationId}:${target.id}`} workspaceId={workspaceId} item={target} /></div></section>
}
