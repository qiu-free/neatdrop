import { useEffect, useRef, useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { api } from '../api'
import type { Workspace } from '../types'
import type { CatalogRegistry, CatalogRoot } from '../catalogTypes'

const labels = { authorized: '已授权', pending_reauthorization: '待重新授权', offline: '目录离线', permission_denied: '权限不足', identity_changed: '目录身份变化' }
export function CatalogPanel({ workspace, onChanged }: { workspace: Workspace | null; onChanged: () => void }) {
  const [registry, setRegistry] = useState<CatalogRegistry | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    api<CatalogRegistry>('/catalog', undefined, controller.signal).then(value => { if (!controller.signal.aborted) setRegistry(value) }).catch(reason => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [])
  async function action(run: (signal: AbortSignal) => Promise<CatalogRegistry>) {
    if (busy) return
    setBusy(true); setError('')
    const signal = lifetime.current.signal
    try { const value = await run(signal); if (!signal.aborted) { setRegistry(value); onChanged() } }
    catch (reason) { if (!signal.aborted) setError(reason instanceof Error ? reason.message : '目录操作未完成。') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  async function choose(root?: CatalogRoot) {
    await action(async signal => {
      const picked = await api<{ path: string | null }>('/pick-directory', {}, signal)
      if (!picked.path) return registry!
      const selected = await api<Workspace>('/workspaces', { path: picked.path }, signal)
      return api<CatalogRegistry>('/catalog/roots', { workspace_id: selected.id, alias: root?.alias ?? selected.name, confirmed: true, ...(root ? { root_id: root.id } : {}) }, signal)
    })
  }
  return <details className="catalog-panel"><summary>资料集合 · {registry?.roots.length ?? 0} / 10 个登记目录</summary><p>仅汇总主动登记、当前会话已授权且可核验的归档副本。重启或会话过期后须重新选择原目录；登记记录不会自动授予文件访问权。</p><p>{workspace ? `当前工作台：${workspace.name}` : '当前工作台尚未选择目录'}</p><div className="catalog-actions"><button className="button secondary" disabled={busy || !registry || !workspace} onClick={() => workspace && void action(signal => api('/catalog/roots', { workspace_id: workspace.id, alias: workspace.name, confirmed: true }, signal))}><FolderPlus size={16} />将当前目录加入资料集合</button><button className="button secondary" disabled={busy || !registry || registry.roots.length >= 10} onClick={() => void choose()}>选择另一个目录加入</button></div><ul>{registry?.roots.map(root => <li key={root.id}><div><strong>{root.alias}</strong><span>{labels[root.status]}</span><small>{root.manual_relation_count} 条集合人工关系</small></div><div>{root.status === 'authorized' ? <button className="text-button" disabled={busy} onClick={() => void action(signal => api(`/catalog/roots/${root.id}/revoke`, { confirmed: true }, signal))}>撤销集合授权</button> : <button className="text-button" aria-label={`重新授权 ${root.alias}`} disabled={busy} onClick={() => void choose(root)}>重新授权</button>}<button className="text-button" disabled={busy} onClick={() => { if (confirm(`移除“${root.alias}”及其 ${root.manual_relation_count} 条集合人工关系？文件和原目录事务记录保持不变。`)) void action(signal => api(`/catalog/roots/${root.id}`, { revision: registry.revision, relations_revision: registry.relations_revision, confirmed: true, remove_relations: true }, signal, 'DELETE')) }}>移除登记</button></div></li>)}</ul><small>撤销只关闭资料集合的访问；当前工作台草稿保留。预览和关系依据会重新核验文件。每页最多1000条，画布最多200个节点。</small>{error ? <p role="alert">{error}</p> : null}</details>
}
