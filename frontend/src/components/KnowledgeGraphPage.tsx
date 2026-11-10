import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, CircleAlert, Database, Expand, Network, RotateCw, Search, Settings2 } from 'lucide-react'
import { api, bytes, explain } from '../api'
import { isWebExperience, runtimeCapabilities } from '../runtimeCapabilities'
import { CatalogPanel } from './CatalogPanel'
import type { CatalogListing } from '../catalogTypes'
import { indexCatalog } from '../catalogIndexing'

import { useSessionState } from '../pageSession'
import type { Workspace, Transaction, Taxonomy } from '../types'
import { TaxonomyProvider, useTaxonomy } from '../taxonomy'
import { createGraphSession, graphKindLabels, rememberGraphPositions, transitionGraphDimension, transitionGraphView, type GraphDimension, type GraphEvidence, type GraphJob, type GraphKind, type GraphListing, type GraphRelation, type GraphSession } from '../graphTypes'
import { defaultGraphVisualSettings, graphLayoutPreset, normalizeGraphVisualSettings } from '../graphSettings'
import { projectGraph } from '../graphProjection'
import { GraphRelations } from './GraphRelations'
import { GraphSettingsPanel } from './GraphSettingsPanel'
import { GraphImageEvidence } from './GraphImageEvidence'
import { LibraryDrawer } from './LibraryPage'
import './graph.css'
const GraphCanvas = lazy(() => import('./GraphCanvas').then(module => ({ default: module.GraphCanvas })))
type Props = { workspace: Workspace | null; history: Transaction[]; taxonomy?: Taxonomy; onWorkbench: () => void; onLibrary: (entryId?: string) => void; session: GraphSession; onContentReady?: (workspaceId: string) => void; catalog?: boolean }
function GraphContent({ workspace, history, session, onLibrary, onWorkbench, onContentReady, catalog = false }: Props) {
  session.visual ??= normalizeGraphVisualSettings()
  session.dimension ??= '2d'
  const { categories, subcategories } = useTaxonomy(), [listing, setListing] = useState<GraphListing | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0)
  const [expansion, setExpansion] = useSessionState(session, 'expanded', {}), [query, setQuery] = useSessionState(session, 'query', ''), [category, setCategory] = useSessionState(session, 'category', 'all'), [kind, setKind] = useSessionState(session, 'kind', 'all'), [view, setView] = useSessionState(session, 'view', 'categories'), [focus, setFocus] = useSessionState(session, 'focus', null)
  const [selected, setSelected] = useState<string | null>(null), [checked, setChecked] = useState<string[]>([]), [consent, setConsent] = useState(false), [analysisOpen, setAnalysisOpen] = useState(false), [manageOpen, setManageOpen] = useState(false), [clearConfirm, setClearConfirm] = useState(false), [job, setJob] = useSessionState(session, 'job', null), [busy, setBusy] = useState(false), [evidence, setEvidence] = useState<GraphEvidence | null>(null), [activeId, setActiveId] = useState<string | null>(null), [target, setTarget] = useState(''), [manualKind, setManualKind] = useState<GraphKind>('related'), [message, setMessage] = useState('')
  const [visualState, setVisual] = useSessionState(session, 'visual', normalizeGraphVisualSettings(session.visual ?? defaultGraphVisualSettings))
  const [dimensionState, setDimension] = useSessionState(session, 'dimension', '2d')
  const visual = visualState ?? defaultGraphVisualSettings, dimension = dimensionState ?? '2d'
  const [settingsOpen, setSettingsOpen] = useState(false), [canvasExpanded, setCanvasExpanded] = useState(false), [layoutRevision, setLayoutRevision] = useState(0)
  const [offset, setOffset] = useState(0), [previousOffsets, setPreviousOffsets] = useState<number[]>([])
  const catalogTask = useRef<AbortController | null>(null), catalogJobPath = useRef<string | null>(null)
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const lifetime = useRef(new AbortController()), evidenceRequest = useRef<AbortController | null>(null), trigger = useRef<HTMLElement | SVGElement | null>(null), base = catalog ? '/catalog/graph' : `/workspaces/${encodeURIComponent(workspace?.id ?? '')}/graph`, selectedRelation = listing?.relations.find(relation => relation.id === selected), active = listing?.items.find(item => item.id === activeId)
  const refresh = useCallback(async (signal?: AbortSignal) => { if (!workspace && !catalog) return; setError(''); try { const effective = signal ?? lifetime.current.signal; const result = await api<GraphListing>(catalog ? `${base}?offset=${offset}&limit=1000` : base, undefined, effective); if (!effective.aborted) { if (catalog) { const page = result as CatalogListing; setListing({ ...page, primary_count: page.items.length, items: [...page.items, ...page.related_items ?? []] } as CatalogListing) } else setListing(result) } } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '无法读取本机图谱。') } }, [workspace, base, catalog, offset])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh, history, reload])
  useEffect(() => { onContentReady?.(workspace?.id ?? '') }, [workspace?.id, onContentReady])
  useEffect(() => { lifetime.current = new AbortController(); return () => { lifetime.current.abort(); evidenceRequest.current?.abort(); catalogTask.current?.abort() } }, [])
  useEffect(() => { if (catalog || !job || !workspace || !['queued', 'running'].includes(job.status)) return; let live = true; const controller = new AbortController(); const poll = async () => { try { const next = await api<GraphJob>(`${base}/jobs/${encodeURIComponent(job.id)}`, undefined, controller.signal); if (!live) return; setJob(next); if (['queued', 'running'].includes(next.status)) timer = window.setTimeout(poll, 600); else { await refresh(); if (next.status === 'cancelled') setMessage('分析已取消'); else if (next.status === 'completed') setMessage(isWebExperience ? '浏览器文本匹配已完成' : '本机分析已完成'); else setMessage(explain(next.error ?? 'GRAPH_JOB_FAILED')) } } catch (reason) { if (live && !controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : '分析状态读取失败。') } }; let timer = window.setTimeout(poll, 500); return () => { live = false; controller.abort(); clearTimeout(timer) } }, [job?.id, job?.status, base, refresh, workspace, catalog])
  useEffect(() => {
    const heading = document.getElementById(analysisOpen ? 'graph-analysis-heading' : manageOpen ? 'graph-index-heading' : '')
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
  }, [analysisOpen, manageOpen])
  useEffect(() => {
    if (!settingsOpen && !canvasExpanded) return
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || activeId) return
      if (settingsOpen) { setSettingsOpen(false); settingsTrigger.current?.focus() }
      else setCanvasExpanded(false)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [settingsOpen, canvasExpanded, activeId])
  const projection = useMemo(() => listing ? projectGraph(listing, { query, category, kind, view, focus, expanded: expansion, visual, taxonomy: { categories, subcategories } }) : null, [listing, query, category, kind, view, focus, expansion, visual, categories, subcategories])
  const closeSettings = () => { setSettingsOpen(false); settingsTrigger.current?.focus() }
  const open = (id: string, relation?: string) => { const item = listing?.items.find(value => value.id === id); if (!item) return; setSettingsOpen(false); evidenceRequest.current?.abort(); setFocus(id); if (relation && view !== 'relations') switchView('relations'); setSelected(relation ?? null); setEvidence(null); setTarget(''); trigger.current = focusedTrigger(); setActiveId(id) }
  const mutate = async (path: string, body: unknown, method: 'POST' | 'DELETE' = 'POST') => { if (busy) return; const signal = lifetime.current.signal; setBusy(true); try { const next = await api<GraphListing>(`${base}${path}`, body, signal, method); if (signal.aborted) return; if (catalog) { const page = next as CatalogListing; setListing({ ...page, primary_count: page.items.length, items: [...page.items, ...page.related_items ?? []] } as CatalogListing) } else setListing(next); setMessage('图谱已更新。'); setEvidence(null); setSelected(null) } catch (reason) { if (!signal.aborted) setMessage(reason instanceof Error ? reason.message : '图谱更新未完成。') } finally { if (!signal.aborted) setBusy(false) } }
  const begin = async () => { if (catalog) {
    if (!listing || !checked.length || !consent || busy) return
    const controller = new AbortController(); catalogTask.current = controller; setBusy(true)
    try {
      const result = await indexCatalog(listing.items.filter(item => checked.includes(item.id)), controller.signal, value => { if (!controller.signal.aborted) setJob(value) }, path => { catalogJobPath.current = path })
      if (!controller.signal.aborted && !lifetime.current.signal.aborted) { setJob(result); setAnalysisOpen(false); await refresh(); setMessage(result.status === 'completed' ? '已完成所选目录的本地索引与集合关系汇总。' : explain(result.error ?? 'GRAPH_JOB_FAILED')) }
    } catch (reason) { if (!controller.signal.aborted) setMessage(reason instanceof Error ? reason.message : '资料集合索引失败。') }
    finally { if (!lifetime.current.signal.aborted) setBusy(false) }
    return
  }; if (!listing || !checked.length || !consent || busy) return; const signal = lifetime.current.signal; setBusy(true); try { const next = await api<GraphJob>(`${base}/jobs`, { entry_ids: checked, confirmed: true }, signal); if (signal.aborted) return; setJob(next); setAnalysisOpen(false); if (!['queued', 'running'].includes(next.status)) await refresh(signal) } catch (reason) { if (!signal.aborted) setMessage(reason instanceof Error ? reason.message : '无法开始本机分析。') } finally { if (!signal.aborted) setBusy(false) } }
  const cancel = async () => { if (catalog) { const path = catalogJobPath.current; if (path) { try { await api(`${path}/cancel`, {}) } catch (reason) { setMessage(reason instanceof Error ? reason.message : '取消未完成。'); return } }; catalogTask.current?.abort(); setJob(current => current ? { ...current, status: 'cancelled', current_file: null } : null); setBusy(false); return }; if (!job || busy) return; const signal = lifetime.current.signal; setBusy(true); try { const next = await api<GraphJob>(`${base}/jobs/${encodeURIComponent(job.id)}/cancel`, {}, signal); if (!signal.aborted) { setJob(next); if (!['queued', 'running'].includes(next.status)) await refresh(signal) } } catch (reason) { if (!signal.aborted) setMessage(reason instanceof Error ? reason.message : '取消请求未完成。') } finally { if (!signal.aborted) setBusy(false) } }
  const closeDrawer = useCallback(() => { evidenceRequest.current?.abort(); setActiveId(null); setEvidence(null); setMessage('') }, [])
  const loadEvidence = async (relation: GraphRelation) => {
    setSettingsOpen(false)
    evidenceRequest.current?.abort()
    const controller = new AbortController()
    evidenceRequest.current = controller
    trigger.current = focusedTrigger()
    setActiveId(relation.source); setEvidence(null); setSelected(relation.id); setMessage('')
    try {
      const next = await api<GraphEvidence>(`${base}/relations/${encodeURIComponent(relation.id)}/evidence`, undefined, controller.signal)
      if (!controller.signal.aborted && !lifetime.current.signal.aborted) setEvidence(next)
    } catch (reason) { if (!controller.signal.aborted && !lifetime.current.signal.aborted) setMessage(reason instanceof Error ? reason.message : '无法读取关系依据。') }
  }
  const chooseCheck = (id: string) => setChecked(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 50 ? [...current, id] : current)
  const expanded = (group: string) => setExpansion(current => ({ ...current, [group]: Math.min(1000, (current[group] ?? 8) + 50) }))
  const toggleCategory = (category: string) => setExpansion(current => ({ ...current, [category]: (current[category] ?? 1) === 0 ? 1 : 0 }))
  const switchDimension = (next: GraphDimension) => { if (dimension === next) return; transitionGraphDimension(session, next); setDimension(next) }
  const resetLayout = () => { setVisual(current => ({ ...current!, layoutPreset: 'balanced', layout: graphLayoutPreset('balanced') })); session.positions = { categories: {}, relations: {} }; setLayoutRevision(value => value + 1) }
  const switchView = (next: 'categories' | 'relations') => { if (session.view === next) return; transitionGraphView(session, session.view, next); setView(next) }
  const selectRelation = (relation: GraphRelation) => { if (view !== 'relations') switchView('relations'); setSelected(relation.id); setFocus(relation.source) }
  const openRelationEvidence = (relation: GraphRelation) => { selectRelation(relation); void loadEvidence(relation) }
  const categoriesInListing = [...new Set(listing?.items.map(item => item.category) ?? [])]
  const groups = [...new Set(projection?.files.map(file => `${file.category}/${file.subcategory ?? ''}`) ?? [])].map(id => {
    const [categoryId, subId] = id.split('/'); return { id, label: `${(categories as Record<string, string>)[categoryId] ?? categoryId} / ${(subcategories as Record<string, Record<string, string>>)[categoryId]?.[subId] ?? '未分子类'}`, count: projection?.files.filter(file => `${file.category}/${file.subcategory ?? ''}` === id).length ?? 0, shown: expansion[id] ?? 8 }
  })
  const selectedBytes = listing?.items.filter(item => checked.includes(item.id)).reduce((sum, item) => sum + item.size, 0) ?? 0
  const drawerRelations = listing && active ? listing.relations.filter(relation => (relation.source === active.id || relation.target === active.id) && (kind === 'all' || relation.kind === kind)) : []
  const intro = <section className="page-intro graph-intro"><div><span className="intro-label">本机资料关系 · 离线优先</span><h1>知识图谱<span>。</span></h1><p>{catalog ? '全部登记、当前会话已授权且可核验的归档资料；来源目录分别标明，不扫描整台电脑。' : isWebExperience ? '浏览浏览器资料库，按真实文本词项计算待核实关系；不是引用或版本推断。' : '当前目录归档资料：按分类浏览副本，或查看文件间待核实关系。内容只在本机读取。'}</p></div></section>
  if (!workspace && !catalog) return <>{intro}<section className="graph-empty"><Archive size={38} /><h2>{isWebExperience ? "先载入学习资料" : "先选择一个本机目录"}</h2><p>{isWebExperience ? "在工作台分析、确认并加入浏览器资料库后，可建立文本关系。" : "知识图谱只读取当前目录生成的归档副本。"}</p><button className="button primary" onClick={onWorkbench}>返回工作台选择目录</button></section></>
  if (error && !listing) return <>{intro}<section className="graph-empty"><CircleAlert size={30} /><h2>图谱暂不可用</h2><p role="alert">{error}</p><button className="button secondary" onClick={() => setReload(value => value + 1)}><RotateCw size={15} />重试</button></section></>
  if (listing && !listing.items.length) return <>{intro}<section className="graph-empty"><Archive size={36} /><h2>{catalog ? '资料集合暂无可用归档资料' : isWebExperience ? '还没有体验资料' : '还没有归档副本'}</h2><p>{catalog ? '展开上方资料集合，加入或重新授权目录；只有已归档且可核验的副本会出现在这里。' : isWebExperience ? '先在工作台分析文本、确认分类并加入体验资料库。' : '先在整理工作台审核并确认生成本机归档副本。'}</p><button className="button primary" onClick={() => onLibrary()}>查看资料库</button></section></>
  return <>
    {intro}
    <section className="graph-workspace"><section className={`graph-main${canvasExpanded ? ' is-expanded' : ''}`} aria-label="知识图谱">
      <header className="graph-toolbar">
        <div className="graph-mode"><button aria-pressed={view === 'categories'} onClick={() => switchView('categories')}>全局图谱</button><button aria-pressed={view === 'relations'} onClick={() => { switchView('relations'); if (!focus) setFocus(projection?.files[0]?.id ?? null) }}>局部关系</button></div>
        <label className="graph-search"><Search size={17} /><input aria-label="搜索图谱文件名" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件名" /></label>
        <span>{projection?.nodes.filter(node => node.data.type === 'file').length ?? 0} / {projection?.files.length ?? 0} 个可见文件</span>
        <button className="button primary" onClick={() => { setAnalysisOpen(value => !value); setManageOpen(false); setSettingsOpen(false) }}><Network size={16} />分析关联</button>
        {!catalog ? <button className="button secondary" onClick={() => { setManageOpen(value => !value); setAnalysisOpen(false); setSettingsOpen(false) }}><Database size={15} />{isWebExperience ? '管理内存索引' : '管理本机索引'}</button> : null}
        <button className="button secondary" onClick={() => setReload(value => value + 1)} aria-label="刷新图谱" title="刷新图谱"><RotateCw size={15} /></button>
        <button className="button secondary" aria-label={canvasExpanded ? '收起画布' : '展开画布'} title={canvasExpanded ? '收起画布' : '展开画布'} onClick={() => { setCanvasExpanded(value => !value); setSettingsOpen(false) }}><Expand size={16} /></button>
        <button ref={settingsTrigger} className="button secondary" aria-label="图谱设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings2 size={16} />设置</button>
      </header>
        <div className="graph-summary" aria-live="polite"><span>{categoriesInListing.length} 个主分类</span><span>{listing?.relations.length ?? 0} 条关系</span><span>索引 {listing?.index.count ?? 0} 项</span><span>{listing?.index.updated ? `上次分析 ${new Date(listing.index.updated).toLocaleString('zh-CN')}` : '尚未分析'}</span>{listing?.index.state === 'unavailable' ? <span role="status">历史索引不可读取</span> : null}</div>
        {analysisOpen ? <section className="graph-analysis graph-panel-open" aria-label="本机分析设置"><h3 id="graph-analysis-heading" tabIndex={-1}>{isWebExperience ? "选择文本关系资料" : "选择本机分析资料"}</h3><p>{isWebExperience ? "仅处理本页已确认的内存文本，不读取磁盘。预计所选大小：" : "最多 50 个副本、单个文件不超过 20 MiB、合计不超过 200 MiB。预计所选大小："}{bytes((listing?.items.filter(item => checked.includes(item.id)).reduce((sum, item) => sum + item.size, 0) ?? 0))}。</p><div className="graph-list">{listing?.items.map(item => <label key={item.id}><input aria-label={`选择 ${item.name}`} type="checkbox" disabled={item.availability !== 'available' || item.size > 20 * 1024 ** 2 || (!checked.includes(item.id) && (checked.length >= 50 || selectedBytes + item.size > 200 * 1024 ** 2))} checked={checked.includes(item.id)} onChange={() => chooseCheck(item.id)} /><span>{item.name} · {bytes(item.size)} · {item.availability === 'available' ? '可读取' : '不可读取'}</span></label>)}</div><p>{checked.length} / 50 已选。{isWebExperience ? "匹配使用实际正文的有限词项；文本随刷新清空。" : "索引只保存有限关键词、位置和图像指纹，不保存原文。"}</p><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{isWebExperience ? '我同意在本页内存保存有限关键词用于关系匹配，不上传，刷新即清空。' : '我同意在本机保存有数量上限的关键词、位置和图像指纹，不上传内容。'}</label><button className="button primary" disabled={busy || !consent || !checked.length || Boolean(job && ['queued', 'running'].includes(job.status))} onClick={() => void begin()}>{isWebExperience ? "开始文本匹配" : "开始本机分析"}</button></section> : null}
        {manageOpen ? <section className="graph-analysis graph-panel-open" aria-label="本机索引管理"><h3 id="graph-index-heading" tabIndex={-1}>本机索引管理</h3><p>索引快照日期仅表示上次分析时间。清除会删除提取特征和自动候选，保留可读取的人工关系和全部文件。</p>{listing?.index.state === 'unavailable' ? <p role="status">索引文件不可读取；重建无法恢复其中已损坏的人工关系。请先保留并检查本机状态。</p> : null}{clearConfirm ? <><p>{listing?.index.state === 'unavailable' ? '重建将替换不可读取的索引，其中已损坏的人工关系无法恢复；原件和归档副本不变。确认清除并重建？' : '确认清除当前目录的本机图谱索引？人工关系仍会保留。'}</p><button className="button primary" onClick={() => { void mutate('/index', { revision: listing!.index.revision }, 'DELETE'); setClearConfirm(false) }}>确认清除索引</button><button className="button secondary" onClick={() => setClearConfirm(false)}>返回</button></> : <button className="button secondary" disabled={!listing || (listing.index.state === 'ready' && !listing.index.count)} onClick={() => setClearConfirm(true)}>清除本机索引</button>}</section> : null}
{listing?.index.issues.length ? <details className="graph-analysis"><summary>索引提示（{listing.index.issues.length}）</summary>{listing.index.issues.map(issue => <p key={`${issue.entry_id}:${issue.code}`}>{listing.items.find(item => item.id === issue.entry_id)?.name ?? ''}：{explain(issue.code)}</p>)}</details> : null}{listing?.truncated ? <p className="graph-legend">当前仅返回最近 1000 个归档副本，已撤回副本不展示。</p> : null}{error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
        <div className="graph-canvas-stage">
          {projection ? <>
            <Suspense fallback={<div className="graph-canvas-wrap" role="status">正在加载本机关系画布…</div>}>
              <GraphCanvas nodes={projection.nodes} edges={projection.edges} expanded={expansion} view={view}
                viewport={session.viewport} visual={visual} dimension={dimension} layoutRevision={layoutRevision}
                positions={session.positions?.[view]} onPositions={value => rememberGraphPositions(session, view, value)}
                onViewport={value => { session.viewport = value }} onExpand={group => group.includes('/') ? expanded(group) : toggleCategory(group)}
                onOpen={open} onRelation={id => { const relation = listing!.relations.find(item => item.id === id); if (relation) openRelationEvidence(relation) }} />
            </Suspense>
            <p className="graph-legend">圆点代表文件，颜色区分类别；同类区域表示分类归属。曲线表示已有关系，实线为事实或人工关系，虚线为待核实候选。悬停查看文件名，点击打开预览。</p>
            {!listing?.relations.length && !listing?.index.count ? <p className="graph-unlinked-notice"><Network size={16} aria-hidden="true" /><span>文件已按类别排列。点击上方“分析关联”，{isWebExperience ? "可在浏览器中按实际正文查找词项关系。" : "可在本机查找文件之间的联系。"}</span></p> : null}
            {projection.hiddenFileCount ? <p className="graph-limit-notice">画布显示 {projection.nodes.filter(node => node.data.type === 'file').length} 个文件，另有 {projection.hiddenFileCount} 个文件保留在下方列表。按分组继续显示可展开更多，画布最多 {projection.maxNodes} 个节点。</p> : null}
            {view === 'relations' && !projection.focus ? <p className="graph-legend">当前筛选隐藏了聚焦文件，请从文件列表选择资料。</p> : null}
          </> : <div className="graph-canvas-wrap" role="status">正在读取本机归档记录…</div>}
          {settingsOpen ? <GraphSettingsPanel category={category} kind={kind} categories={categories} categoryIds={categoriesInListing}
            categoryColors={projection?.categoryColors ?? {}} categoryCounts={Object.fromEntries(categoriesInListing.map(id => [id, projection?.files.filter(file => file.category === id).length ?? 0]))}
            groups={groups} expansion={expansion} visual={visual} dimension={dimension}
            onCategory={value => { setCategory(value); if (value !== 'all' && focus && listing?.items.find(item => item.id === focus)?.category !== value) setFocus(null) }}
            onKind={setKind} onCategoryToggle={toggleCategory} onGroupMore={expanded}
            onGroupCollapse={id => setExpansion(current => ({ ...current, [id]: 0 }))}
            onVisual={setVisual} onDimension={switchDimension} onRearrange={() => setLayoutRevision(value => value + 1)} onReset={resetLayout} onClose={closeSettings} /> : null}
        </div>
    </section></section>
    <section className="graph-results">{catalog ? <div className="catalog-scope"><span>共 {(listing as CatalogListing | null)?.total ?? 0} 项 · 本页 {(listing as CatalogListing | null)?.primary_count ?? 0} 项，关联补充 {(listing as CatalogListing | null)?.related_items?.length ?? 0} 项</span><button className="button secondary" disabled={!previousOffsets.length || busy} onClick={() => { setActiveId(null); setOffset(previousOffsets.at(-1) ?? 0); setPreviousOffsets(current => current.slice(0, -1)) }}>上一页</button><button className="button secondary" disabled={(listing as CatalogListing | null)?.next_offset == null || busy} onClick={() => { setActiveId(null); setPreviousOffsets(current => [...current, offset]); setOffset((listing as CatalogListing).next_offset!) }}>下一页</button></div> : null}{catalog && (listing as CatalogListing | null)?.relations_truncated ? <p className="notice">本页验证或关联补充达到预算，部分关系尚未显示。请翻页、缩小资料集合或稍后重试；未核验内容不会作为当前关系。</p> : null}
      <details className="graph-accessible-files" aria-label="可访问文件列表" open>
        <summary>文件列表 <span>{projection?.files.length ?? 0}</span></summary>
        <ul className="graph-list">{projection?.files.map(item => <li key={item.id}><button aria-current={focus === item.id || selectedRelation?.source === item.id || selectedRelation?.target === item.id ? 'true' : undefined} onClick={() => open(item.id)}>{item.name}</button><span>{item.source_alias ? `${item.source_alias} · ` : ''}{categories[item.category] ?? item.category}{item.subcategory && subcategories[item.category]?.[item.subcategory] ? ` / ${subcategories[item.category][item.subcategory]}` : ''}</span><button className="button secondary" aria-label={`预览 ${item.name}`} onClick={() => open(item.id)}>预览</button></li>)}</ul>
      </details>
      {listing ? <details className="graph-relations-disclosure" open><summary>文件关系 <span>{projection?.relations.length ?? 0}</span></summary>
        <GraphRelations hideHeading listing={{ ...listing, relations: projection?.relations ?? [] }} selected={selected} onSelect={id => { const relation = listing.relations.find(item => item.id === id); if (relation) selectRelation(relation) }} onEvidence={openRelationEvidence} onDismiss={relation => void mutate(`/relations/${encodeURIComponent(relation.id)}/dismiss`, { revision: listing.index.revision })} />
      </details> : null}
        {selectedRelation?.origin === 'manual' ? <p className="graph-drawer-actions"><button className="button secondary" onClick={() => void mutate(`/relations/${encodeURIComponent(selectedRelation.id)}`, { revision: listing!.index.revision }, 'DELETE')}>删除人工关系</button></p> : null}
        {job ? <div className="graph-job" role="status"><span>{job.status === 'running' || job.status === 'queued' ? '正在分析' : job.status === 'completed' ? '分析已完成' : job.status === 'cancelled' ? '分析已取消' : explain(job.error ?? 'GRAPH_JOB_FAILED')}</span><progress max={Math.max(job.total, 1)} value={job.processed} /><span>{job.processed} / {job.total}{job.current_file ? ` · ${job.current_file}` : ''}</span>{job.errors.map(error => <span key={error.entry_id}>{listing?.items.find(item => item.id === error.entry_id)?.name}: {explain(error.code)}</span>)}{['running', 'queued'].includes(job.status) ? <button className="button secondary" onClick={() => void cancel()}>取消分析</button> : null}</div> : null}
</section>
    {active && listing ? <LibraryDrawer workspaceId={active.workspace_id ?? workspace?.id ?? ""} previewPath={catalog ? `/catalog/library/${encodeURIComponent(active.id)}/preview` : undefined} item={active} categoryLabel={categories[active.category] ?? active.category} trigger={trigger.current} onClose={closeDrawer} position={0} total={1} content={<>{!catalog ? <button className="button secondary" onClick={() => { closeDrawer(); onLibrary(active.id) }}>在资料库查看</button> : <p>来源目录：{active.source_alias}</p>}{message ? <p role="alert">{message}</p> : null}{drawerRelations.length ? <GraphRelations listing={{ ...listing, relations: drawerRelations }} selected={selected} onSelect={id => { const relation = listing.relations.find(item => item.id === id); if (relation) selectRelation(relation) }} onEvidence={openRelationEvidence} onDismiss={relation => void mutate(`/relations/${encodeURIComponent(relation.id)}/dismiss`, { revision: listing.index.revision })} /> : null}{selectedRelation?.status === 'suggested' && evidence?.relation.id === selectedRelation.id ? <><button className="button primary" onClick={() => void mutate('/relations', { source: selectedRelation.source, target: selectedRelation.target, kind: 'related', revision: listing.index.revision, candidate_id: selectedRelation.id })}>确认为相关资料</button></> : null}{selectedRelation?.origin === 'manual' ? <button className="button secondary" onClick={() => void mutate(`/relations/${encodeURIComponent(selectedRelation.id)}`, { revision: listing.index.revision }, 'DELETE')}>删除人工关系</button> : null}{evidence ? <div className="graph-evidence"><strong>依据与限制</strong><p>{evidence.explanation}</p>{!catalog && selectedRelation?.kind === 'visual_similar' && evidence.files.length >= 2 ? <GraphImageEvidence workspaceId={workspace?.id ?? ""} relationId={selectedRelation.id} source={listing.items.find(item => item.id === selectedRelation.source)!} target={listing.items.find(item => item.id === selectedRelation.target)!} /> : null}{evidence.files.map(file => <div key={file.id}><b>{file.name}</b><p>{file.summary}</p>{file.excerpts.map((excerpt, index) => <blockquote key={index}>{excerpt}</blockquote>)}</div>)}</div> : null}<form className="graph-manual" onSubmit={event => { event.preventDefault(); if (!target) return; void mutate('/relations', { source: active.id, target, kind: manualKind, revision: listing.index.revision }); setTarget('') }}><label>关系目标文件<select aria-label="关系目标文件" value={target} onChange={event => setTarget(event.target.value)}><option value="">选择目标</option>{listing.items.filter(item => item.id !== active.id && item.availability === 'available').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>人工关系类型<select aria-label="人工关系类型" value={manualKind} onChange={event => setManualKind(event.target.value as GraphKind)}>{(['related', 'reference', 'attachment', 'version'] as GraphKind[]).map(value => <option key={value} value={value}>{graphKindLabels[value]}</option>)}</select></label><span>{active.name}{manualKind === 'reference' ? ' 引用 ' : manualKind === 'attachment' ? ' 配套说明 ' : manualKind === 'version' ? ' 是后续版本，前一版本为 ' : ' 与 '}{target ? listing.items.find(item => item.id === target)?.name : '目标文件'}</span><button className="button primary" disabled={busy || active.availability !== 'available' || !target}>保存人工关系</button></form></>} /> : null}</>
}
export function KnowledgeGraphPage(props: Props) {
  const [scope, setScope] = useState<'workspace' | 'catalog'>('workspace'), [catalogRevision, setCatalogRevision] = useState(0)
  const catalogSession = useRef(createGraphSession('catalog'))
  if (props.session.workspace !== (props.workspace?.id ?? null)) Object.assign(props.session, createGraphSession(props.workspace?.id ?? null))
  return <TaxonomyProvider taxonomy={props.taxonomy}>{runtimeCapabilities.canAggregateRoots ? <><label className="catalog-scope">图谱范围<select aria-label="图谱范围" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="workspace">当前目录归档资料</option><option value="catalog">全部已授权资料集合</option></select></label>{scope === 'catalog' ? <CatalogPanel workspace={props.workspace} onChanged={() => { Object.assign(catalogSession.current, createGraphSession('catalog')); setCatalogRevision(value => value + 1) }} /> : null}</> : null}<GraphContent key={scope === 'catalog' ? `catalog-${catalogRevision}` : props.workspace?.id ?? 'empty'} {...props} catalog={scope === 'catalog'} session={scope === 'catalog' ? catalogSession.current : props.session} /></TaxonomyProvider>
}

function focusedTrigger() {
  const element = document.activeElement
  return element instanceof HTMLElement || element instanceof SVGElement ? element : null
}




















