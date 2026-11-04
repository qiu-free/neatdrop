import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ChevronLeft, ChevronRight, CircleAlert, Eye, FolderOpen, LoaderCircle, RotateCw, Search, ShieldCheck, X } from 'lucide-react'
import { api, bytes } from '../api'
import { requestPreview } from '../previewRequests'
import { TaxonomyProvider, useTaxonomy } from '../taxonomy'
import type { LibraryItem, LibraryListing, Preview, Taxonomy, Transaction, Workspace } from '../types'
import { useSessionState, type LibrarySession } from '../pageSession'
import './library.css'

const availabilityLabels: Record<LibraryItem['availability'], string> = {
  available: '可预览', missing: '副本已丢失', changed: '副本已变化', unverified: '未验证记录',
}
const unavailableMessages: Partial<Record<LibraryItem['availability'], string>> = {
  missing: '归档副本已丢失，无法预览。原件保留，请在本机核对文件。',
  changed: '归档副本已变化，无法预览。请在本机核对文件。',
  unverified: '这项记录没有本机可信凭据，无法预览。请在本机核对文件。',
}

function displayDate(created: string) {
  const date = new Date(created)
  return Number.isNaN(date.getTime()) ? '日期不可用' : date.toLocaleString('zh-CN')
}

export function LibraryPage({ workspace, history, taxonomy, onWorkbench, session }: {
  workspace: Workspace | null; history: Transaction[]; taxonomy?: Taxonomy; onWorkbench: () => void; session?: LibrarySession
}) {
  return <TaxonomyProvider taxonomy={taxonomy}>
    <section className="page-intro"><div><span className="intro-label">已生成的本机归档副本</span><h1>资料有序，随时查阅<span>。</span></h1><p>{workspace ? workspace.path : '选择资料所在的本机目录，查看净匣曾生成的归档副本。'}</p></div></section>
    {workspace ? <LibraryContent key={workspace.id} workspace={workspace} history={history} session={session} /> : <section className="library-empty"><FolderOpen size={38} strokeWidth={1.4} /><h2>先选择一个本机目录</h2><p>资料库来自当前目录的本地归档记录。刷新后重新选择同一目录，即可再次查看。</p><button className="button primary" onClick={onWorkbench}>返回工作台选择目录</button></section>}
    <p className="library-local-note"><ShieldCheck size={17} />文件保存在本机；预览由本地服务核验后读取，不上传云端。</p>
  </TaxonomyProvider>
}

function LibraryContent({ workspace, history, session }: { workspace: Workspace; history: Transaction[]; session?: LibrarySession }) {
  const { categories, subcategories } = useTaxonomy()
  const [listing, setListing] = useState<LibraryListing | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  // A different authorized workspace gets a fresh filter. Same-workspace page
  // revisits retain the filter, without retaining a mounted preview drawer.
  const [pageSession] = useState(() => {
    if (session && session.workspace !== workspace.id) Object.assign(session, { workspace: workspace.id, category: 'all', query: '' })
    return session
  })
  const [category, setCategory] = useSessionState(pageSession, 'category', 'all')
  const [query, setQuery] = useSessionState(pageSession, 'query', '')
  const [activeId, setActiveId] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const close = useCallback(() => setActiveId(null), [])
  useEffect(() => {
    const controller = new AbortController()
    setListing(null)
    setError('')
    setActiveId(null)
    api<LibraryListing>(`/workspaces/${encodeURIComponent(workspace.id)}/library`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setListing(value) })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取资料库，请重试。') })
    return () => controller.abort()
  }, [workspace.id, workspace.path, history, reload])
  const items = listing?.items ?? []
  const needle = query.trim().toLocaleLowerCase()
  const visible = items.filter(item => (category === 'all' || category === item.category) && (!needle || item.name.toLocaleLowerCase().includes(needle)))
  const active = items.find(item => item.id === activeId)
  const position = visible.findIndex(item => item.id === activeId)
  return <section className="library-panel" aria-label="资料库文件">
    <header className="library-panel-heading"><div><h2><Archive size={21} />归档副本</h2><p aria-live="polite">{listing ? category === 'all' && !needle ? `共 ${items.length} 项` : `显示 ${visible.length} / ${items.length} 项` : '正在读取本地记录'}</p></div><button className="button secondary" aria-label="重新加载资料库" onClick={() => setReload(value => value + 1)}><RotateCw size={16} />刷新</button></header>
    <div className="library-filters"><label>主分类<select aria-label="主分类" value={category} onChange={event => setCategory(event.target.value)}><option value="all">全部分类</option>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="library-search"><span className="sr-only">搜索资料库文件名</span><Search size={17} /><input aria-label="搜索资料库文件名" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件名" type="search" autoComplete="off" /></label></div>
    {error ? <div className="library-empty"><CircleAlert size={28} /><p role="alert">{error}</p><button className="button secondary" onClick={() => setReload(value => value + 1)}>重试读取</button></div> : !listing ? <div className="library-empty" role="status"><LoaderCircle className="library-spinner" size={25} /><p>正在读取资料库…</p></div> : !items.length ? <div className="library-empty"><Archive size={36} strokeWidth={1.4} /><h3>还没有归档副本</h3><p>在工作台完成分析、审核并确认生成副本后，它们会出现在这里。已撤回的副本不再列出。</p></div> : !visible.length ? <div className="library-empty"><Search size={28} /><h3>没有符合条件的归档副本</h3><p>试试其他文件名或主分类。</p><button className="button secondary" onClick={() => { setCategory('all'); setQuery('') }}>清除筛选</button></div> : <ul className="library-list">{visible.map(item => <li key={item.id} className={item.id === activeId ? 'library-item is-active' : 'library-item'}>
      <div className="library-item-heading"><button className="library-file-button" aria-label={`查看 ${item.name}`} onClick={event => { trigger.current = event.currentTarget; setActiveId(item.id) }}><Eye size={18} /><strong>{item.name}</strong></button><span className={`library-availability ${item.availability === 'available' ? 'available' : 'unavailable'}`}>{availabilityLabels[item.availability]}</span></div>
      <div className="library-item-meta"><span>{categories[item.category] ?? '其他'}{item.subcategory && subcategories[item.category]?.[item.subcategory] ? ` / ${subcategories[item.category][item.subcategory]}` : ''}</span><time dateTime={item.created}>{displayDate(item.created)}</time><span>{bytes(item.size)}</span></div>
      <dl className="library-paths"><div><dt>来源</dt><dd>{item.source}</dd></div><div><dt>实际路径</dt><dd>{item.target}</dd></div></dl>
    </li>)}</ul>}
    {listing?.truncated ? <p className="library-truncated"><CircleAlert size={17} />资料较多，仅显示最近的 1000 项。可在本机按实际路径查找其他归档副本。</p> : null}
    {active ? <LibraryDrawer workspaceId={workspace.id} item={active} categoryLabel={categories[active.category] ?? '其他'} onClose={close} trigger={trigger.current} position={position} total={visible.length} onPrevious={position > 0 ? () => setActiveId(visible[position - 1].id) : undefined} onNext={position >= 0 && position < visible.length - 1 ? () => setActiveId(visible[position + 1].id) : undefined} /> : null}
  </section>
}

function LibraryDrawer({ workspaceId, item, categoryLabel, onClose, trigger, position, total, onPrevious, onNext }: {
  workspaceId: string; item: LibraryItem; categoryLabel: string; onClose: () => void; trigger: HTMLElement | null
  position: number; total: number; onPrevious?: () => void; onNext?: () => void
}) {
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(trigger)
  const [loaded, setLoaded] = useState<{ id: string; preview?: Preview; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoaded(null)
    if (item.availability === 'available') {
      requestPreview(`/workspaces/${encodeURIComponent(workspaceId)}/library/${encodeURIComponent(item.id)}/preview`, controller.signal)
        .then(preview => { if (!controller.signal.aborted) setLoaded({ id: item.id, preview }) })
        .catch(reason => { if (!controller.signal.aborted) setLoaded({ id: item.id, error: reason instanceof Error ? reason.message : '预览读取失败，请关闭后重试。' }) })
    }
    return () => controller.abort()
  }, [workspaceId, item.id, item.availability])
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const overlay = panel.current?.parentElement
    const background = [...document.body.children].filter(node => node !== overlay && node instanceof HTMLElement) as HTMLElement[]
    const inertStates = background.map(node => node.inert)
    background.forEach(node => { node.inert = true })
    closeButton.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key !== 'Tab') return
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')
      if (!controls?.length) { event.preventDefault(); panel.current?.focus(); return }
      const first = controls[0], last = controls[controls.length - 1]
      const outside = !panel.current?.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current || outside)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current || outside)) { event.preventDefault(); first.focus() }
    }
    const keepFocus = (event: FocusEvent) => { if (!panel.current?.contains(event.target as Node)) closeButton.current?.focus() }
    document.addEventListener('keydown', keyboard)
    document.addEventListener('focusin', keepFocus)
    return () => {
      document.removeEventListener('keydown', keyboard)
      document.removeEventListener('focusin', keepFocus)
      document.body.style.overflow = previousOverflow
      background.forEach((node, index) => { node.inert = inertStates[index] })
      if (restoreFocus.current?.isConnected) restoreFocus.current.focus()
    }
  }, [onClose])
  const current = loaded?.id === item.id ? loaded : null
  const unavailable = unavailableMessages[item.availability]
  const preview = current?.preview
  // Image responses are already decoded by the local service. Never use an
  // archive path or a remote URL as an image source in the browser.
  const image = preview?.image && /^data:image\/(?:png|jpeg|webp);base64,/.test(preview.image) ? preview.image : undefined
  return createPortal(<div className="library-overlay"><button type="button" className="library-backdrop" aria-label="关闭资料库详情遮罩" tabIndex={-1} onClick={onClose} /><aside ref={panel} className="library-drawer" role="dialog" aria-modal="true" aria-label="归档副本详情" tabIndex={-1}>
    <header className="library-drawer-heading"><div><span>资料库</span><h2>归档副本详情</h2></div><button ref={closeButton} className="icon-button" aria-label="关闭资料库详情" onClick={onClose}><X size={21} /></button></header>
    <div className="library-drawer-body"><h3>{item.name}</h3><div className="library-item-meta"><span>{categoryLabel}</span><span>{bytes(item.size)}</span><span className={`library-availability ${item.availability === 'available' ? 'available' : 'unavailable'}`}>{availabilityLabels[item.availability]}</span></div>
      <section className="library-preview" aria-label="归档副本预览" aria-busy={!unavailable && !current}>
        {unavailable ? <p className="library-preview-message" role="status"><CircleAlert size={22} />{unavailable}</p> : current?.error ? <p className="library-preview-message" role="alert"><CircleAlert size={22} />{current.error}</p> : !preview ? <p className="library-preview-message"><LoaderCircle className="library-spinner" size={25} />正在核验并读取本机副本…</p> : image ? <img src={image} alt={`${item.name} 的归档副本预览`} /> : preview.text ? <pre>{preview.text}</pre> : <p className="library-preview-message">此文件没有可显示的文本或图像预览。</p>}
      </section>
      {preview?.truncated ? <p className="library-preview-note">为控制本地读取量，当前显示部分内容。</p> : null}
      {preview?.sampling?.summary ? <p className="library-preview-note">{preview.sampling.summary}</p> : null}
      <dl className="library-detail-metadata"><div><dt>生成日期</dt><dd>{displayDate(item.created)}</dd></div><div><dt>来源</dt><dd>{item.source}</dd></div><div><dt>实际相对路径</dt><dd>{item.target}</dd></div></dl>
    </div><footer className="library-drawer-footer"><p>原件保留 · 文件位于当前授权目录</p><div><button className="icon-button" aria-label="上一个归档副本" disabled={!onPrevious} onClick={event => {
      // Move focus before React disables the boundary control; browsers may
      // otherwise leave focus on a disabled button or drop it to the body.
      if (position === 1 && document.activeElement === event.currentTarget) closeButton.current?.focus({ preventScroll: true })
      onPrevious?.()
    }}><ChevronLeft size={20} /></button><span>{position + 1} / {total}</span><button className="icon-button" aria-label="下一个归档副本" disabled={!onNext} onClick={event => {
      if (position === total - 2 && document.activeElement === event.currentTarget) closeButton.current?.focus({ preventScroll: true })
      onNext?.()
    }}><ChevronRight size={20} /></button></div></footer>
  </aside></div>, document.body)
}
