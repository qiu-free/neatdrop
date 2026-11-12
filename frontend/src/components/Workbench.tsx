import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, CircleAlert, FolderInput, FolderOpen, LoaderCircle, RotateCw, Search, ShieldCheck, Sparkles, X } from 'lucide-react'
import { api, explain } from '../api'
import { FileTable } from './FileTable'
import { Inspector } from './Inspector'
import { ConsentDialog } from './ConsentDialog'
import { PlanDialog } from './PlanDialog'
import { Modal } from './Modal'
import { type Category } from '../types'
import { TaxonomyProvider, useTaxonomy } from '../taxonomy'
import { FileGrid } from './FileGrid'
import type { useWorkspace } from '../useWorkspace'
import { visibleFiles } from '../fileSelection'
import { useSessionState, type WorkbenchSession } from '../pageSession'
import { WorkflowOverview } from './WorkflowOverview'
import { supportedFormats } from '../supportedFormats'
import { runtimeCapabilities, isWebExperience } from '../runtimeCapabilities'
import { TextImport } from '../experience/TextImport'
import { RecordedExamples } from '../experience/RecordedExamples'
import { BoundaryExamples } from '../experience/BoundaryExamples'
import { reviewEligibility } from '../reviewEligibility'
import { PersonalRulesPanel } from './PersonalRulesPanel'
import type { WorkflowStage } from '../workflow'

type State = ReturnType<typeof useWorkspace>
type ResetRequest = { type: 'scan'; path: string } | { type: 'rescan' } | { type: 'child'; fileId: string }
type ConsentRequest = { fileIds: string[]; initialMode: 'local' | 'cloud'; retry: boolean }

const analysisPhaseLabels: Record<string, string> = {
  queued: '排队中', preparing: '准备中', model: '云端识别', classifying: '分类中',
  completed: '已完成', cancelled: '已取消', canceled: '已取消', failed: '失败',
}

export function Workbench(props: {
  state: State; onTutorial?: () => void; onHistory?: () => void; onLibrary?: () => void; onSettings?: () => void; onHelp?: (topic: string) => void; offlineFirst?: boolean; active?: boolean; session?: WorkbenchSession
}) {
  return <TaxonomyProvider taxonomy={props.state.config?.taxonomy} contentForms={props.state.config?.content_forms}><WorkbenchContent {...props} /></TaxonomyProvider>
}

function WorkbenchContent({ state, onTutorial, onHistory, onLibrary, onSettings, onHelp, offlineFirst, active: pageActive = true, session }: {
  state: State; onTutorial?: () => void; onHistory?: () => void; onLibrary?: () => void; onSettings?: () => void; onHelp?: (topic: string) => void; offlineFirst?: boolean; active?: boolean; session?: WorkbenchSession
}) {
  const { categories, taxonomy } = useTaxonomy()
  const [viewChoice, setViewChoice] = useSessionState(session, 'viewChoice', null)
  const [path, setPath] = useSessionState(session, 'path', '')
  const [savedStage, setStage] = useSessionState(session, 'stage', 'choose')
  const [filter, setFilter] = useSessionState(session, 'filter', 'all')
  const [query, setQuery] = useSessionState(session, 'query', '')
  const [consent, setConsent] = useState<ConsentRequest | null>(null)
  const [resetRequest, setResetRequest] = useState<ResetRequest | null>(null)
  const [picking, setPicking] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailVisited, setDetailVisited] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [ruleSeed, setRuleSeed] = useState<{ fileId: string; category: string; subcategory: string | null } | null>(null)
  const [bulkCategory, setBulkCategory] = useSessionState(session, 'bulkCategory', 'other')
  const scrollRoot = useRef<HTMLDivElement>(null)
  const stageSurface = useRef<HTMLDivElement>(null)
  const pickerRequest = useRef<AbortController | null>(null)
  const pathWorkspace = useRef(session?.workspace ?? null)
  const inspectorColumnRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const navigationFocusRef = useRef<'previous' | 'next' | null>(null)
  const pageActiveRef = useRef(pageActive)
  pageActiveRef.current = pageActive
  const { workspace, selected, busy, config, suggestions, edits, errors, reviewed, activeId } = state
  const files = workspace?.files ?? []
  const visible = useMemo(() => visibleFiles(files, suggestions, edits, selected, filter, query, errors, reviewed), [files, suggestions, edits, selected, filter, query, errors, reviewed])
  const effectiveId = visible.some(file => file.id === activeId) ? activeId : visible[0]?.id ?? null
  const active = visible.find(file => file.id === effectiveId)
  const activeIndex = visible.findIndex(file => file.id === effectiveId)
  const supported = files.filter(file => file.supported)
  const retryIds = Object.keys(errors).filter(id => files.some(file => file.id === id))
  const selectedFiles = files.filter(file => selected.has(file.id))
  const eligibility = reviewEligibility(files, selected, suggestions, edits, errors)
  const approvalEligible = eligibility.eligible
  const ordinaryPending = eligibility.ordinary.filter(file => !reviewed.has(file.id))
  const approvalCount = approvalEligible.filter(file => !reviewed.has(file.id)).length
  const approvalSkipped = selected.size - approvalEligible.length
  const selectedReviewed = selectedFiles.filter(file => reviewed.has(file.id)).length
  const reviewCount = files.filter(file => suggestions[file.id]?.review_required && !reviewed.has(file.id)).length
  const failedCount = retryIds.length
  const unreviewedCount = files.filter(file => (suggestions[file.id] || edits[file.id]) && !reviewed.has(file.id)).length
  const visibleSupported = visible.filter(file => file.supported)
  const visibleSelectable = visibleSupported
  const imageCount = supported.filter(file => ['.png', '.jpg', '.jpeg', '.webp'].includes(file.extension.toLowerCase())).length
  const view = viewChoice && viewChoice.workspace === workspace?.id ? viewChoice.view : imageCount > 0 && imageCount >= supported.length / 2 ? 'grid' : 'list'
  const visibleAllSelected = visibleSelectable.length > 0 && visibleSelectable.every(file => selected.has(file.id))
  const activeAnalysis = Boolean(state.job && ['queued', 'running'].includes(state.job.status))
  const pendingExecution = !!state.execution && ['planned', 'queued', 'running'].includes(state.execution.status)
  const workflowLocked = !!busy || picking || pendingExecution
  const selectionReady = !!workspace && selected.size > 0 && selectedFiles.length === selected.size && selectedFiles.every(file => file.supported)
  const unfinishedAnalysis = selectedFiles.filter(file => !suggestions[file.id] || errors[file.id]).length
  const analysisReady = selectionReady && !unfinishedAnalysis && !activeAnalysis
  const canCreatePlan = analysisReady && !busy && approvalEligible.length === selected.size && [...selected].every(id => reviewed.has(id)) && (!!config?.execution_supported || runtimeCapabilities.canOrganizeInMemory)
  const stage = pendingExecution ? 'results' : savedStage === 'review' && !analysisReady ? selectionReady ? 'analyze' : 'choose'
    : savedStage === 'results' && !state.plan && !state.execution ? analysisReady ? 'review' : selectionReady ? 'analyze' : 'choose'
      : savedStage === 'analyze' && !workspace ? 'choose' : savedStage
  const executionFinished = !!state.execution && !['planned', 'queued', 'running'].includes(state.execution.status) && !busy
  const copiesReady = executionFinished && state.execution!.items.some(item => item.stage === 'completed')
  const stepLocks: Partial<Record<WorkflowStage, string>> = {
    analyze: !selectionReady ? '请先选择目录并勾选要整理的文件。' : undefined,
    review: stage === 'choose' ? '请先完成第2步分析，再进入复核。' : !analysisReady ? '请先完成全部已选文件的分析；失败项可重试或取消选择。' : undefined,
    copy: stage === 'choose' || stage === 'analyze' ? '请先依次完成分析和人工复核。' : stage === 'review' && !canCreatePlan ? '请先审核全部已选文件的当前分类与名称。' : undefined,
    library: stage !== 'results' || !copiesReady ? `请先完成${isWebExperience ? '加入资料库' : '计划确认与副本生成'}。` : undefined,
    history: stage !== 'results' || !executionFinished ? '请先完成本次整理，再查看结果记录。' : undefined,
  }
  const stepHint = stage === 'choose' ? !workspace ? '第1步：先选择目录或载入资料，再勾选本批文件。' : !selectionReady ? '第1步：勾选至少一个可处理文件，才能进入分析。' : '第1步已就绪：进入分析后，先完成所选文件的识别。'
    : stage === 'analyze' ? activeAnalysis ? '第2步：分析尚未结束，请等待完成或取消；未完成项不能进入复核。' : !analysisReady ? `第2步：还有 ${unfinishedAnalysis} 个已选文件未完成分析，请先分析或处理失败项。` : '第2步已完成：点击“查看建议”，进入人工复核。'
      : stage === 'review' ? !canCreatePlan ? '第3步：核对并审核全部已选文件后，才能生成整理计划。修改后需要重新审核。' : '第3步已完成：生成计划后，还须独立核对并勾选执行确认。'
        : !executionFinished ? '第4步：核对计划并独立确认，执行期间请等待结果；状态不明确时只查询原计划。' : copiesReady ? '本次整理已有成功结果，可查看资料库和操作记录。' : '本次整理没有成功项，请从操作记录核对失败原因。'
  const drawerVisible = pageActive && stage !== 'results' && detailOpen && Boolean(active)

  useLayoutEffect(() => { if (savedStage !== stage) setStage(stage) }, [savedStage, stage, setStage])

  useLayoutEffect(() => {
    const list = scrollRoot.current?.querySelector<HTMLElement>('.table-scroll, .file-grid-region')
    if (list && session) list.scrollTop = session.listScroll
  }, [session, view, stage])
  useEffect(() => () => { pickerRequest.current?.abort() }, [])
  useLayoutEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const animation = stageSurface.current?.animate?.([{ opacity: .75, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' })
    return () => animation?.cancel()
  }, [stage])

  const closeConsent = useCallback(() => setConsent(null), [])
  const closeReset = useCallback(() => setResetRequest(null), [])

  useEffect(() => {
    if (activeId !== effectiveId) state.setActiveId(effectiveId)
  }, [activeId, effectiveId, state.setActiveId])

  useEffect(() => {
    if (workspace && pathWorkspace.current !== workspace.id) {
      pathWorkspace.current = workspace.id
      if (session) session.workspace = workspace.id
      setPath(workspace.path)
    }
  }, [workspace?.id, workspace?.path])

  useEffect(() => {
    if (state.plan) setStage('results')
  }, [state.plan?.id])
  useEffect(() => { if (state.execution) setStage('results') }, [state.execution?.plan_id])

  useEffect(() => {
    if (!pageActive || stage === 'results' || !active) setDetailOpen(false)
  }, [pageActive, stage, active?.id])

  useEffect(() => {
    if (!drawerVisible) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const layer = inspectorColumnRef.current
    const background = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== layer)
    const previouslyInert = background.map(node => node.hasAttribute('inert'))
    background.forEach(node => node.setAttribute('inert', ''))
    layer?.querySelector<HTMLButtonElement>('.close-detail')?.focus({ preventScroll: true })
    const containFocus = (event: FocusEvent) => {
      if (!layer?.contains(event.target as Node)) layer?.querySelector<HTMLButtonElement>('.close-detail')?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('focusin', containFocus)
      document.body.style.overflow = previousOverflow
      background.forEach((node, index) => { if (!previouslyInert[index]) node.removeAttribute('inert') })
      if (pageActiveRef.current && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
      returnFocusRef.current = null
    }
  }, [drawerVisible])

  useEffect(() => {
    const inspector = inspectorColumnRef.current?.querySelector<HTMLElement>('.inspector')
    if (navigationFocusRef.current && inspector) {
      const direction = navigationFocusRef.current
      const next = inspector.querySelector<HTMLButtonElement>('button[aria-label="下一个文件"]')
      const previous = inspector.querySelector<HTMLButtonElement>('button[aria-label="上一个文件"]')
      const preferred = direction === 'next' ? next : previous
      const alternate = direction === 'next' ? previous : next
      const close = inspector.querySelector<HTMLButtonElement>('.close-detail')
      const target = preferred && !preferred.disabled ? preferred
        : alternate && !alternate.disabled ? alternate
          : close ?? inspector
      target.focus({ preventScroll: true })
      navigationFocusRef.current = null
      return
    }
  }, [drawerVisible, active?.id])

  async function runScan(nextPath: string, prepare?: () => Promise<void>, signal?: AbortSignal) {
    const result = await (prepare || signal ? state.scan(nextPath, prepare, signal) : state.scan(nextPath))
    if (!signal?.aborted && result) {
      setStage('choose')
      setDetailOpen(false)
      returnFocusRef.current = null
    }
    return result
  }

  async function requestScan(nextPath: string) {
    if (workflowLocked) return
    const normalizedPath = nextPath.trim()
    if (!normalizedPath) return
    setPath(normalizedPath)
    if (workspace) {
      setResetRequest({ type: 'scan', path: normalizedPath })
      return
    }
    await runScan(normalizedPath)
  }

  async function pickDirectory() {
    if (workflowLocked || !state.online) return
    const controller = new AbortController()
    pickerRequest.current?.abort()
    pickerRequest.current = controller
    setPicking(true)
    state.setError('')
    try {
      const result = await api<{ path: string | null }>('/pick-directory', {}, controller.signal)
      if (!controller.signal.aborted && result.path) await requestScan(result.path)
    } catch (err) {
      if (!controller.signal.aborted) state.setError(err instanceof Error ? err.message : '无法打开目录选择器。')
    } finally {
      if (!controller.signal.aborted) setPicking(false)
    }
  }

  async function confirmReset() {
    if (workflowLocked) return
    const request = resetRequest
    if (!request) return
    setResetRequest(null)
    if (request.type === 'scan') await runScan(request.path)
    else if (request.type === 'child') {
      await state.openChild(request.fileId)
      setStage('choose'); setDetailOpen(false); returnFocusRef.current = null
    }
    else {
      await state.rescan()
      setStage('choose')
      setDetailOpen(false)
      returnFocusRef.current = null
    }
  }

  function rememberDrawerTrigger(target?: HTMLElement) {
    if (detailOpen) return
    const candidate = target ?? document.activeElement
    returnFocusRef.current = candidate instanceof HTMLElement && candidate !== document.body ? candidate : null
  }

  function openDetails(target?: HTMLElement) {
    rememberDrawerTrigger(target)
    navigationFocusRef.current = null
    setDetailVisited(true)
    setDetailOpen(true)
  }

  function activate(id: string) {
    openDetails()
    state.setActiveId(id)
  }

  function closeDetails() {
    setDetailOpen(false)
  }

  function navigateInspector(id: string, direction: 'previous' | 'next') {
    navigationFocusRef.current = direction
    state.setActiveId(id)
    setDetailOpen(true)
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!drawerVisible) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDetails()
      return
    }
    if (event.key !== 'Tab') return
    const inspector = inspectorColumnRef.current?.querySelector('.inspector')
    const candidates = [...inspector?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []].filter(node => {
      if (node.closest('[hidden], [inert]')) return false
      for (const details of node.closest('details') ? [node.closest('details')!] : []) {
        if (!details.open && node !== details.querySelector('summary')) return false
      }
      const style = window.getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden'
    })
    if (!candidates?.length) {
      event.preventDefault()
      return
    }
    const first = candidates[0]
    const last = candidates[candidates.length - 1]
    if (event.shiftKey && (document.activeElement === first || !inspector?.contains(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !inspector?.contains(document.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  function toggleVisibleSelection() {
    const next = new Set(selected)
    if (visibleAllSelected) visibleSelectable.forEach(file => next.delete(file.id))
    else visibleSelectable.forEach(file => next.add(file.id))
    state.setSelected(next)
  }

  function applyBulkCategory() {
    const selectedFiles = files.filter(file => selected.has(file.id) && file.supported)
    for (const file of selectedFiles) {
      const suggestion = suggestions[file.id]
      const edit = edits[file.id]
      state.edit({
        file_id: file.id,
        name: edit?.name ?? suggestion?.name ?? file.name,
        category: bulkCategory,
        subcategory: null,
      })
    }
  }

  function beginAnalysis(fileIds = [...selected], initialMode: 'local' | 'cloud' = offlineFirst === false && config?.model.configured ? 'cloud' : 'local', retry = false) {
    if (!['analyze', 'review'].includes(stage) || !fileIds.length || activeAnalysis || busy) return
    setStage('analyze')
    setConsent({ fileIds, initialMode, retry })
  }

  function retryFailed() {
    if (retryIds.length) beginAnalysis(retryIds, state.job?.mode === 'cloud' ? 'cloud' : 'local', true)
  }

  function createPlan() {
    if (stage !== 'review' || !canCreatePlan) return
    void state.createPlan()
  }

  function navigateStep(next: WorkflowStage) {
    if (workflowLocked || state.plan || stepLocks[next]) return
    if (next === 'library') onLibrary?.()
    else if (next === 'history') onHistory?.()
    else if (next === 'copy') { if (stage === 'review') createPlan(); else if (state.execution) setStage('results') }
    else setStage(next)
  }
  function editReviewedFile(value: Parameters<State['edit']>[0]) {
    if (stage === 'review' && !busy && !activeAnalysis && suggestions[value.file_id] && !errors[value.file_id]) state.edit(value)
  }

  return <div ref={scrollRoot} className="workbench-content" onScrollCapture={event => {
    if (session && event.target instanceof HTMLElement && event.target.matches('.table-scroll, .file-grid-region')) session.listScroll = event.target.scrollTop
  }}>
    <section className="page-intro">
      <div><span className="intro-label">一点秩序，更多从容</span><h1>给文件，一个清晰的归处<span>。</span></h1><p>把杂乱交给净匣，把决定留给你。先预览，再安心整理。</p></div>
      {isWebExperience ? <button className="button primary" disabled={workflowLocked || !config} onClick={() => config && void requestScan(config.demo_path)}>载入学习样例</button> : null}
    </section>

    {isWebExperience ? <nav aria-label="网页体验五阶段"><ol className="experience-steps">{([{ id: 'choose', label: '载入资料' }, { id: 'analyze', label: '分析与看依据' }, { id: 'review', label: '核对分类' }, { id: 'copy', label: '加入资料库' }, { id: 'library', label: '查找与关联' }] as const).map((item, index) => <li key={item.id} aria-current={(stage === 'results' ? 'copy' : stage) === item.id ? 'step' : undefined}><button type="button" title={stepLocks[item.id]} aria-describedby="workbench-step-hint" disabled={workflowLocked || !!stepLocks[item.id]} onClick={() => navigateStep(item.id)}>{index + 1}. {item.label}</button></li>)}</ol></nav> : null}
    {!isWebExperience ? <WorkflowOverview current={stage === 'results' ? 'copy' : stage} label="整理步骤" working={workflowLocked} blocked={stepLocks} describedBy="workbench-step-hint" onNavigate={navigateStep} /> : null}
    <p id="workbench-step-hint" className="workbench-step-hint" aria-live="polite">{stepHint}</p>

    <section className="directory-panel">
      <div className="directory-icon"><FolderInput size={30} strokeWidth={1.35} /></div>
      <div className="directory-content">
        <div className="directory-heading"><h2>{workspace ? workspace.name : isWebExperience ? '从学习资料开始' : '从一个文件夹开始'}</h2>{workspace ? <span className="small-badge">{files.length} 项 · {supported.length} 项可处理</span> : <span className="small-badge">{isWebExperience ? '浏览器计算' : '仅在本机处理'}</span>}</div>
        {!isWebExperience ? <form onSubmit={event => { event.preventDefault(); void requestScan(path) }} className="path-form">
          <label htmlFor="directory-path" className="sr-only">本地目录完整路径</label>
          <input id="directory-path" value={path} onChange={event => setPath(event.target.value)} placeholder="粘贴本地文件夹完整路径，例如 C:\Users\你的用户名\Downloads" autoComplete="off" spellCheck={false} disabled={workflowLocked} />
          <button className="button primary choose-directory" type="button" disabled={workflowLocked || picking || !state.online} onClick={() => void pickDirectory()}><FolderOpen size={16} />{picking ? '等待选择…' : '选择本地目录'}</button><button className="button secondary" disabled={!path.trim() || workflowLocked || !state.online}>{busy === 'scan' ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}扫描目录</button>
        </form> : <TextImport disabled={workflowLocked} hasWorkspace={!!workspace} onImported={runScan} />}
        <div className="directory-foot"><span>{isWebExperience ? '浏览器内存 · 不上传文本 · 刷新即清空' : '只扫描当前目录 · 单批 ≤50 项 / 200 MiB · 不永久删除'}</span><button className="text-button" disabled={workflowLocked || !config} onClick={() => { if (config) void requestScan(config.demo_path) }}>试用人工样例 <ArrowUpRightIcon /></button></div>
      </div>
    </section>

    {isWebExperience ? <><RecordedExamples /><BoundaryExamples disabled={workflowLocked} onLoaded={runScan} /></> : null}
    {!workspace ? <section className="empty-landing" aria-label="开始使用">
      <div className="empty-landing-icon"><FolderOpen size={27} /></div>
        <div><h2>{isWebExperience ? '整理一组学习资料' : '从一个本地文件夹开始'}</h2><p>{isWebExperience ? '载入样例或选择文本，查看真实分类依据，确认后加入浏览器资料库，再探索词项关系。' : '先扫描当前目录，再挑选要整理的文件。分析、复核和生成副本都由你确认。'}</p>
        <div className="empty-landing-actions">{isWebExperience ? <button className="button primary" disabled={workflowLocked || !config} onClick={() => config && void requestScan(config.demo_path)}>开始学习样例</button> : null}{onTutorial ? <button className="button secondary" onClick={onTutorial}>开始安全练习</button> : null}</div>
      </div>
      <span className="empty-kbd"><ShieldCheck size={14} />{isWebExperience ? '文本只在浏览器中处理，不改动原始文件' : '文件保留在本机，原件始终保留'}</span>
    </section> : <>
      <div className="workspace-path"><FolderOpen size={13} /><span>{workspace.path}</span><button className="icon-button" aria-label="重新扫描目录" title="重新扫描，清除旧建议" disabled={workflowLocked} onClick={() => setResetRequest({ type: 'rescan' })}><RotateCw size={14} /></button></div>
      <div className="workspace-summary"><p><strong>整理来源：</strong>{workspace.path}</p><p>{isWebExperience ? '结果位置：浏览器内存资料库；不创建真实文件副本。' : '副本位置：当前文件夹内的分类子目录，原件保留。'}</p><p>{supported.length} 个可处理文件 · {files.filter(file => file.reason === 'DIRECTORY_SKIPPED').length} 个子文件夹（当前不进入） · {files.filter(file => !file.supported && file.reason !== 'DIRECTORY_SKIPPED').length} 项暂不支持或已跳过</p></div>

      <div ref={stageSurface} className="workbench-stage-surface">
      {stage !== 'results' ? <section className="work-area">
        <div className="file-panel">
          <div className="file-panel-heading"><h2>{stage === 'choose' ? '选择需要整理的文件' : stage === 'analyze' ? '分析与进度' : '检查建议并确认'} <span>{visible.length.toString().padStart(2, '0')}</span></h2><div className="search-field"><Search size={15} /><input aria-label="搜索文件" placeholder="搜索文件…" value={query} onChange={event => setQuery(event.target.value)} /></div></div>
          <div className="table-toolbar">
            <div className="filter-tabs" aria-label="文件筛选">
              {([
                { key: 'all', label: '全部', count: files.length },
                { key: 'unreviewed', label: '待确认', count: unreviewedCount },
                { key: 'review', label: '待复核', count: reviewCount },
                { key: 'failed', label: '失败', count: failedCount },
                { key: 'selected', label: '已选择', count: selected.size },
              ] as const).map(tab => <button key={tab.key} type="button" className={filter === tab.key ? 'selected' : ''} aria-pressed={filter === tab.key} onClick={() => setFilter(tab.key)}>{tab.label}<span>{tab.count}</span></button>)}
            </div>
            <button className="text-button select-all" disabled={!!busy || !visibleSelectable.length} onClick={toggleVisibleSelection}>{visibleAllSelected ? '取消选择可见项' : '选择可见项'}</button>
          </div>
          {stage === 'review' ? <div className="review-toolbar review-toolbar-v6">
            <div className="review-main"><button className="button primary" disabled={!!busy || activeAnalysis || !approvalCount} onClick={() => state.approveSelected()}>一键审核已选项（{approvalCount}）</button><span>已确认 {selectedReviewed} 项 · 剩余待确认 {selected.size - selectedReviewed} 项</span></div>
            <p>确认已选文件的当前分类与名称，包括筛选外已选项和待复核候选。当前包含 {eligibility.candidates.length} 项待复核、{eligibility.mainOnly.length} 项仅主类或待分类；人工确认不代表算法已判定可靠。修改后需要重新审核；{isWebExperience ? '加入资料库' : '生成副本'}前仍需独立确认。</p>
            {approvalSkipped ? <p className="review-skipped">{approvalSkipped} 项尚未分析或存在未处理错误，请先分析或编辑，错误项需重新分析。</p> : null}
            <details className="review-more"><summary>更多操作</summary><div className="review-advanced">
              <label>批量分类<select aria-label="批量分类" value={bulkCategory} onChange={event => setBulkCategory(event.target.value as Category)}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <button className="button secondary" disabled={!!busy || !selected.size} onClick={applyBulkCategory}>应用到已选择项</button>
              <button className="button secondary" disabled={!selected.size || !!busy || activeAnalysis} onClick={() => beginAnalysis()}><Sparkles size={16} />重新分析所选</button>
              <button className="button secondary" disabled={!!busy || activeAnalysis || !ordinaryPending.length} onClick={() => state.approveOrdinary(ordinaryPending.map(file => file.id))}>确认普通建议（{ordinaryPending.length}）</button>
              <span>更改分类后需要重新审核。</span>
            </div></details>
          </div> : null}
          <div className="safe-banner"><ShieldCheck size={14} /><span>{isWebExperience ? '浏览器计算 / 内存整理 / 不创建磁盘副本' : <>保留原件<span className="separator">/</span>生成归档副本<span className="separator">/</span>执行前再次确认</>}</span></div>
          <div className="selection-legend"><span><i className="legend-active" />点击文件查看详情</span><span><i className="legend-checked" />勾选加入整理批次</span></div>
          <div className="file-view-switch" role="group" aria-label="文件显示方式"><button type="button" aria-pressed={view === 'grid'} onClick={() => setViewChoice({ workspace: workspace.id, view: 'grid' })}>图片网格</button><button type="button" aria-pressed={view === 'list'} onClick={() => setViewChoice({ workspace: workspace.id, view: 'list' })}>文件列表</button><span>勾选加入批次，核对确认后才可{isWebExperience ? '加入资料库' : '生成副本'}。</span></div>
          {view === 'grid' ? <FileGrid workspaceId={workspace.id} files={visible} suggestions={suggestions} edits={edits} selected={selected} activeId={drawerVisible ? effectiveId : null} reviewed={reviewed} errors={errors} selectionDisabled={!!busy} taxonomy={taxonomy} onSelect={state.toggle} onActive={activate} /> : <FileTable files={files} suggestions={suggestions} edits={edits} selected={selected} activeId={drawerVisible ? effectiveId : null} filter={filter} query={query} errors={errors} reviewed={reviewed} selectionDisabled={!!busy} onSelect={state.toggle} onActive={activate} />}
          <div className="table-note"><span>{files.filter(file => !file.supported).length ? `${files.filter(file => !file.supported).length} 项不支持或已跳过，原文件保留` : supportedFormats(config?.supported_extensions)}</span><span>{isWebExperience ? '预录资料仅供查看' : '不递归扫描'}</span></div>
          {!isWebExperience && files.some(file => file.reason === 'DIRECTORY_SKIPPED') ? <details className="child-directories"><summary>打开子文件夹（单独授权，不递归）</summary><p>将清除当前草稿并打开所选子目录。原件和既有副本保持不变。</p>{files.filter(file => file.reason === 'DIRECTORY_SKIPPED').map(file => <button key={file.id} className="button secondary" disabled={!!busy} onClick={() => setResetRequest({ type: 'child', fileId: file.id })}><FolderOpen size={16} />在此目录中打开：{file.name}</button>)}</details> : null}
        </div>
          {stage === 'review' && !isWebExperience ? <details className="personal-rules-workbench" open={rulesOpen} onToggle={event => setRulesOpen(event.currentTarget.open)}><summary>本目录分类规则</summary><p>预览当前已完成的离线分析，再明确保存规则。</p>{workspace ? <PersonalRulesPanel key={workspace.id} workspaceId={workspace.id} jobId={state.job?.mode === 'local' && state.job.status === 'completed' ? state.job.id : null} categories={categories} subcategories={Object.fromEntries(Object.entries(taxonomy).map(([id, group]) => [id, group.subcategories]))} extensions={config?.supported_extensions} seed={ruleSeed} onClose={() => setRulesOpen(false)} onSettings={() => onSettings?.()} onHelp={topic => onHelp?.(topic)} /> : null}</details> : null}
      </section> : <ExecutionResults execution={state.execution} busy={busy} onCheck={() => void state.checkExecution()} onHistory={onHistory ? () => navigateStep('history') : undefined} onLibrary={onLibrary ? () => navigateStep('library') : undefined} />}
      </div>

      {failedCount ? <div className="analysis-errors"><div className="analysis-errors-heading"><strong><CircleAlert size={14} />{failedCount} 项分析失败</strong><button className="button secondary" disabled={!['analyze', 'review'].includes(stage) || !!busy || activeAnalysis} onClick={retryFailed}>仅重试失败项</button></div>{retryIds.map(id => <p key={id}><strong>{files.find(file => file.id === id)?.name}</strong>：{explain(errors[id])}</p>)}</div> : null}
      {busy === 'analysis' && state.job ? <div className="progress-region" role="status" aria-live="polite"><div><LoaderCircle size={16} className="spin" /><span>正在分析 {state.job.processed} / {state.job.total}{state.job.current_file ? ` · ${state.job.current_file}` : ''}{state.job.phase ? ` · ${analysisPhaseLabels[state.job.phase] ?? state.job.phase}` : ''}，未执行文件操作</span><button className="text-button" onClick={() => void state.cancel()}>取消分析</button></div><progress value={state.job.processed} max={Math.max(state.job.total, 1)} /></div> : null}
      {busy !== 'analysis' && state.job && ['running', 'queued'].includes(state.job.status) ? <div className="progress-region recovery-progress" role="status"><div><CircleAlert size={16} /><span>进度连接已中断。已完成的建议保留；可继续查询同一分析任务。</span><button className="button secondary" onClick={() => void state.resumeAnalysis()}><RotateCw size={14} />继续查询进度</button><button className="text-button" onClick={() => void state.cancel()}>取消任务</button></div><progress value={state.job.processed} max={Math.max(state.job.total, 1)} /></div> : null}
      {config && !config.execution_supported && !runtimeCapabilities.canOrganizeInMemory ? <div className="notice">当前平台可以扫描、预览和分析，不能生成归档副本。</div> : null}

      {stage !== 'results' ? <footer className="action-bar">
        <div><strong>已选择 <em>{selected.size}</em> 个文件</strong><span>{selected.size ? `${[...selected].filter(id => reviewed.has(id)).length} 项已确认；建议不会自动应用` : '从可见列表中明确选择需要处理的文件'}</span></div>
        <div className="action-buttons">
          {stage === 'choose' ? <button className="button primary" disabled={!selectionReady || !!busy || picking} onClick={() => navigateStep('analyze')}>下一步：分析 <ArrowRight size={16} /></button> : null}
          {stage === 'analyze' ? <><button className="button secondary" disabled={!selected.size || !!busy || activeAnalysis} onClick={() => beginAnalysis() }><Sparkles size={16} />分析选中文件</button><button className="button primary" disabled={!analysisReady || !!busy} onClick={() => navigateStep('review')}>查看建议</button></> : null}
          {stage === 'review' ? <button className="button primary" disabled={!canCreatePlan} onClick={createPlan}>{busy === 'plan' ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}生成整理计划</button> : null}
        </div>
      </footer> : null}
    </>}

    {detailVisited && workspace && active ? createPortal(<div ref={inspectorColumnRef} className="app-shell workbench-detail-layer" hidden={!drawerVisible} aria-hidden={!drawerVisible} onKeyDown={handleDrawerKeyDown}>
      <button type="button" tabIndex={-1} className="detail-backdrop" aria-label="关闭详情遮罩" onClick={closeDetails} />
      <Inspector key={workspace.id} workspaceId={workspace.id} workspacePath={workspace.path} file={active} suggestion={suggestions[active.id]} edit={edits[active.id]} onEdit={editReviewedFile} config={config} editingDisabled={stage !== 'review' || !!busy || activeAnalysis || !suggestions[active.id] || !!errors[active.id]} editingHint={stage !== 'review' ? '完成分析并进入第3步后可编辑' : undefined} checked={selected.has(active.id)} reviewed={reviewed.has(active.id)} analysisError={errors[active.id]} previewEnabled={drawerVisible} onApprove={() => { if (stage === 'review' && !busy && !activeAnalysis && suggestions[active.id] && !errors[active.id]) state.approve(active.id) }} onCreateRule={stage === 'review' && reviewed.has(active.id) && suggestions[active.id]?.provider !== 'cloud_model' ? seed => { closeDetails(); setRuleSeed(seed); setRulesOpen(true) } : undefined} onRetry={errors[active.id] && ['analyze', 'review'].includes(stage) ? () => beginAnalysis([active.id], state.job?.mode === 'cloud' ? 'cloud' : 'local', true) : undefined} onRescan={!isWebExperience ? () => { closeDetails(); setResetRequest({ type: 'rescan' }) } : undefined} onSettings={!isWebExperience && onSettings ? () => { closeDetails(); onSettings() } : undefined} onHelp={onHelp ? topic => { closeDetails(); onHelp(topic) } : undefined} onClose={closeDetails} drawerOpen={drawerVisible} position={activeIndex} total={visible.length} onPrevious={() => navigateInspector(visible[Math.max(0, activeIndex - 1)].id, 'previous')} onNext={() => navigateInspector(visible[Math.min(visible.length - 1, activeIndex + 1)].id, 'next')} />
    </div>, document.body) : null}
    {consent ? <ConsentDialog key={`${consent.retry ? 'retry' : 'analysis'}-${consent.fileIds.join(',')}`} count={consent.fileIds.length} config={config} initialMode={consent.initialMode} onClose={closeConsent} onStart={(mode, approved, binding) => { setConsent(null); void state.analyze(mode, approved, consent.fileIds, binding) }} /> : null}
    {state.plan ? <PlanDialog key={state.plan.id} plan={state.plan} busy={busy === 'execute'} onClose={() => { state.setPlan(null); setStage('review') }} onConfirm={() => { setStage('results'); void state.execute() }} /> : null}
    {resetRequest ? <Modal title={resetRequest.type === 'rescan' ? '重新扫描并清除当前草稿？' : '切换目录并清除当前草稿？'} onClose={closeReset} busy={!!busy}>
      <p className="modal-description">{isWebExperience ? '这会清除本页中的选择、分析建议、手动编辑、计划和内存资料库，原始文件不会改变。' : '这会清除当前目录在本次会话中的选择、分析建议、手动编辑和计划。磁盘上的原文件与已生成副本保持不变。'}</p>
      <div className="notice"><ShieldCheck size={18} /><span>{isWebExperience ? '重新载入后可以再次分析和复核；需要保留结果时请先导出清单。' : '新扫描只读取所选目录的一层文件。清除草稿后可以重新选择和复核。'}</span></div>
      <footer className="modal-footer"><button className="button secondary" onClick={closeReset} disabled={!!busy}>保留当前草稿</button><button className="button primary" onClick={() => void confirmReset()} disabled={!!busy}>{busy === 'scan' ? <LoaderCircle className="spin" size={16} /> : <X size={16} />}清除草稿并继续</button></footer>
    </Modal> : null}
  </div>
}

function ExecutionResults({ execution, busy, onCheck, onHistory, onLibrary }: {
  execution: State['execution']; busy: string; onCheck: () => void; onHistory?: () => void; onLibrary?: () => void
}) {
  if (!execution) return <section className="execution-results empty-results"><div className="empty-landing-icon"><ShieldCheck size={26} /></div><h2>整理结果会显示在这里</h2><p>生成计划后，先核对路径并勾选确认。执行时会逐项显示成功、失败和未开始状态。</p></section>
  const completed = execution.items.filter(item => item.stage === 'completed').length
  const failed = execution.items.filter(item => item.stage === 'failed').length
  const notRun = execution.items.filter(item => item.stage === 'planned').length
  const running = ['planned', 'queued', 'running'].includes(execution.status)
  return <section className="execution-results" aria-label="执行结果">
    <header><div><span className="intro-label">本次整理</span><h2>{running ? isWebExperience ? '正在加入内存资料库' : '正在生成归档副本' : execution.status === 'completed' ? '整理已完成' : '整理已结束，需要检查'}</h2><p>{completed} 项成功 · {failed} 项失败 · {notRun} 项未开始</p></div><span className={`execution-status ${running ? 'running' : execution.status}`}>{running ? '进行中' : execution.status === 'completed' ? '已完成' : execution.status === 'partial' ? '部分完成' : execution.status === 'interrupted' ? '已中断' : execution.status}</span></header>
    <div className="execution-progress"><div><span>{execution.processed} / {execution.total} 项</span>{execution.current_file ? <strong>当前文件：{execution.current_file}</strong> : null}</div><progress value={execution.processed} max={Math.max(execution.total, 1)} /></div>
    {execution.error ? <p className="execution-error"><CircleAlert size={15} />{explain(execution.error)}</p> : null}
    <div className="execution-items">{execution.items.map(item => <article className={`execution-item ${item.stage}`} key={item.file_id}><div><strong>{item.source}</strong><span>{item.target}</span></div><b>{item.stage === 'completed' ? '成功' : item.stage === 'failed' ? '失败' : item.stage === 'copying' ? '处理中' : '未开始'}</b>{item.error ? <small>{explain(item.error)}</small> : null}</article>)}</div>
    <footer className="execution-actions"><span>{isWebExperience ? '结果只在浏览器内存；没有生成磁盘副本，刷新会清空。' : '原件全部保留。状态可在操作记录中再次核对。'}</span><div>{onLibrary && !running && completed > 0 ? <button className="button primary" onClick={onLibrary}>查看资料库</button> : null}{onHistory ? <button className="button secondary" disabled={running || !!busy} onClick={onHistory}>查看操作记录</button> : null}<button className="button secondary" disabled={busy === 'execute'} onClick={onCheck}>{busy === 'execute' ? <LoaderCircle size={15} className="spin" /> : <RotateCw size={15} />}重新查询状态</button></div></footer>
  </section>
}

function ArrowUpRightIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M7 17 17 7M7 7h10v10" /></svg> }
