import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Settings2, ChevronRight, X } from 'lucide-react'
import { useWorkspace } from './useWorkspace'
import { Sidebar } from './components/Sidebar'
import { Workbench } from './components/Workbench'
import { HistoryPage } from './components/HistoryPage'
import { LibraryPage } from './components/LibraryPage'
import { createGraphSession, type GraphSession } from './graphTypes'
import { HelpPage } from './components/HelpPage'
import { SettingsDialog } from './components/SettingsDialog'
import { FirstRunTour } from './components/FirstRunTour'
import { TutorialPractice } from './components/TutorialPractice'
import { loadPreferences, savePreferences } from './preferences'
import type { Page } from './types'
import { createPageSession, resetLibrarySession } from './pageSession'
import { useThemeEffects } from './useThemeEffects'
import { isWebExperience } from './runtimeCapabilities'
import { ExperienceBanner } from './experience/ExperienceBanner'
import './navigation.css'
const KnowledgeGraphPage = lazy(() => import('./components/KnowledgeGraphPage').then(module => ({ default: module.KnowledgeGraphPage })))

export default function App() {
  useThemeEffects()
  const state = useWorkspace()
  const session = useRef(createPageSession()).current
  const pageContent = useRef<HTMLDivElement>(null)
  const pageRef = useRef<Page>('workbench')
  const graphSession = session.graph as GraphSession
  const navigationRequested = useRef(false)
  const pendingScroll = useRef<{ workspace: string; top: number; dispose: () => void } | null>(null)
  const scrollWorkspace = useRef<string | null>(null)
  const [page, setPage] = useState<Page>('workbench')
  const [settings, setSettings] = useState(false)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [tour, setTour] = useState(() => !isWebExperience && loadPreferences().tutorial.tourStatus === 'unseen')
  const [practice, setPractice] = useState(false)
  useEffect(() => {
    const refresh = () => setPreferences(loadPreferences())
    window.addEventListener('neatdrop:preferences', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('neatdrop:preferences', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  const finishTour = useCallback((status: 'skipped' | 'completed') => {
    setTour(false)
    setPreferences(current => {
      const next = { ...current, tutorial: { ...current.tutorial, tourCompleted: status === 'completed', tourStatus: status } }
      savePreferences(next)
      return next
    })
  }, [])
  const closeTour = useCallback(() => finishTour('skipped'), [finishTour])
  const completeTour = useCallback(() => finishTour('completed'), [finishTour])
  const openPractice = useCallback(() => { setTour(false); setPractice(true) }, [])
  const closePractice = useCallback(() => setPractice(false), [])
  const completePractice = useCallback(() => {
    setPreferences(current => {
      const next = { ...current, tutorial: { ...current.tutorial, exerciseCompleted: true } }
      savePreferences(next)
      return next
    })
  }, [])
  const changePreferences = useCallback((next: ReturnType<typeof loadPreferences>) => {
    setPreferences(next)
    savePreferences(next)
  }, [])
  const toggleSidebar = () => changePreferences({ ...preferences, sidebarCollapsed: !preferences.sidebarCollapsed })
  const clearPendingScroll = useCallback(() => {
    const pending = pendingScroll.current
    pendingScroll.current = null
    pending?.dispose()
  }, [])
  useEffect(() => clearPendingScroll, [clearPendingScroll])
  useEffect(() => {
    const workspaceId = state.workspace?.id ?? null
    if (scrollWorkspace.current === workspaceId) return
    scrollWorkspace.current = workspaceId
    session.scroll.library = 0
    session.scroll.history = 0
    session.scroll.graph = 0
    Object.assign(session.graph, createGraphSession(workspaceId))
    clearPendingScroll()
  }, [state.workspace?.id, session, clearPendingScroll])
  const navigate = useCallback((next: Page) => {
    if (next === pageRef.current) return
    // A short loading view can clamp the browser's current Y. Preserve the
    // intended position if the user leaves before its listing is ready.
    session.scroll[pageRef.current] = pendingScroll.current?.top ?? window.scrollY
    clearPendingScroll()
    pageRef.current = next
    navigationRequested.current = true
    if (next === 'library' && state.workspace) {
      const cancel = () => clearPendingScroll()
      const interact = (event: Event) => {
        if (event.target === document.documentElement || event.target === document.body || event.target instanceof Node && pageContent.current?.contains(event.target)) cancel()
      }
      const scrollKey = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel()
      }
      window.addEventListener('wheel', cancel, { passive: true })
      window.addEventListener('touchmove', cancel, { passive: true })
      window.addEventListener('keydown', scrollKey)
      window.addEventListener('pointerdown', interact)
      window.addEventListener('input', interact)
      window.addEventListener('change', interact)
      pendingScroll.current = { workspace: state.workspace.id, top: session.scroll.library, dispose: () => {
        window.removeEventListener('wheel', cancel)
        window.removeEventListener('touchmove', cancel)
        window.removeEventListener('keydown', scrollKey)
        window.removeEventListener('pointerdown', interact)
        window.removeEventListener('input', interact)
        window.removeEventListener('change', interact)
      } }
    }
    setPage(next)
  }, [session, state.workspace?.id, clearPendingScroll])
  const restoreLibraryScroll = useCallback((workspaceId: string) => {
    const pending = pendingScroll.current
    if (pageRef.current !== 'library' || pending?.workspace !== workspaceId) return
    clearPendingScroll()
    window.scrollTo({ top: pending.top, behavior: 'instant' })
  }, [clearPendingScroll])
  const graphContentReady = useCallback(() => {
    if (pageRef.current !== 'graph' || !navigationRequested.current) return
    const heading = pageContent.current?.querySelector<HTMLElement>('h1')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus({ preventScroll: true })
    navigationRequested.current = false
    window.scrollTo({ top: session.scroll.graph, behavior: 'instant' })
  }, [session])
  // Child cleanup runs before this effect, so an old drawer cannot steal the
  // destination's focus or leave the new page inert. No transition timers gate state.
  useEffect(() => {
    if (!navigationRequested.current) return
    if (page === 'graph') return
    navigationRequested.current = false
    const heading = pageContent.current?.querySelector<HTMLElement>('h1')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus({ preventScroll: true })
    window.scrollTo({ top: pendingScroll.current ? 0 : session.scroll[page], behavior: 'instant' })
  }, [page, session])
  async function refreshModelConfig() {
    await state.refreshConfig()
  }
  const openSettings = useCallback(() => setSettings(true), [])
  const openHelp = useCallback((topic: string) => {
    session.help.query = ''
    const hash = `#help-topic-${topic}`
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
    else window.location.hash = hash
    navigate('help')
  }, [navigate, session])
  const titles = { workbench: '整理工作台', library: '资料库', graph: '知识图谱', history: '操作记录', help: '使用说明' }
  return <div className="app-shell" data-density={preferences.density} data-sidebar-collapsed={!!preferences.sidebarCollapsed}><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>跳到主内容</a><Sidebar page={page} onPage={navigate} online={state.online} workspace={state.workspace} collapsed={preferences.sidebarCollapsed} onToggle={toggleSidebar} exerciseCompleted={preferences.tutorial.exerciseCompleted} /><div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={13} aria-hidden="true" /><strong>{titles[page]}</strong></div>{!isWebExperience ? <button className="button settings-button" onClick={openSettings}><Settings2 size={15} aria-hidden="true" />模型设置<span className={`status-dot ${state.config?.model.configured ? 'online' : ''}`} /></button> : null}</header><main id="main-content" tabIndex={-1}>
    {isWebExperience ? <ExperienceBanner /> : null}
    {state.error ? <div className="alert error" role="alert"><CircleAlert size={18} /><span>{state.error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => state.setError('')}><X size={16} /></button></div> : null}
    {state.message ? <div className="alert success" role="status"><CheckCircle2 size={18} /><span>{state.message}</span><button className="icon-button" aria-label="关闭状态提示" onClick={() => state.setMessage('')}><X size={16} /></button></div> : null}
    <div key={page} className="page-transition" ref={pageContent} data-page={page}>
      {page === 'workbench' ? <Workbench state={state} session={session.workbench} onLibrary={() => navigate('library')} onTutorial={openPractice} onHistory={() => navigate('history')} onSettings={openSettings} onHelp={openHelp} offlineFirst={preferences.offlineFirst} /> : page === 'library' ? <LibraryPage workspace={state.workspace} history={state.history} taxonomy={state.config?.taxonomy} session={session.library} onContentReady={restoreLibraryScroll} onWorkbench={() => navigate('workbench')} onGraph={entryId => { graphSession.workspace = state.workspace?.id ?? null; graphSession.focus = entryId; graphSession.query = ''; graphSession.category = 'all'; graphSession.kind = 'all'; graphSession.viewport = null; graphSession.view = 'relations'; navigate('graph') }} /> : page === 'graph' ? <Suspense fallback={<p role="status">正在加载知识图谱…</p>}><KnowledgeGraphPage workspace={state.workspace} history={state.history} taxonomy={state.config?.taxonomy} session={graphSession} onContentReady={graphContentReady} onWorkbench={() => navigate('workbench')} onLibrary={entryId => { if (entryId) { resetLibrarySession(session.library, state.workspace?.id ?? null); session.library.focus = entryId } navigate('library') }} /></Suspense> : page === 'history' ? <HistoryPage state={state} /> : <HelpPage session={session.help} supportedExtensions={state.config?.supported_extensions} onPractice={openPractice} onReplayTour={() => setTour(true)} exerciseCompleted={preferences.tutorial.exerciseCompleted} />}
    </div>
    <div className="page-bottom"><span>NeatDrop 净匣</span><span>少一点杂乱，多一点从容。</span><span>LOCAL FIRST · MVP 0.1</span></div>
  </main></div>{settings ? <SettingsDialog config={state.config} onClose={() => setSettings(false)} onSaved={refreshModelConfig} preferences={preferences} onPreferencesChange={changePreferences} /> : null}
    {tour ? <FirstRunTour onClose={closeTour} onComplete={completeTour} onPractice={openPractice} /> : null}
    {practice ? <TutorialPractice onClose={closePractice} onStart={() => { setPractice(false); navigate('workbench') }} completed={preferences.tutorial.exerciseCompleted} onComplete={completePractice} /> : null}
  </div>
}


