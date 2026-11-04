import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Settings2, ChevronRight, X } from 'lucide-react'
import { useWorkspace } from './useWorkspace'
import { Sidebar } from './components/Sidebar'
import { Workbench } from './components/Workbench'
import { HistoryPage } from './components/HistoryPage'
import { LibraryPage } from './components/LibraryPage'
import { HelpPage } from './components/HelpPage'
import { SettingsDialog } from './components/SettingsDialog'
import { FirstRunTour } from './components/FirstRunTour'
import { TutorialPractice } from './components/TutorialPractice'
import { loadPreferences, savePreferences } from './preferences'
import type { Page } from './types'
import { createPageSession } from './pageSession'
import './navigation.css'

export default function App() {
  const state = useWorkspace()
  const session = useRef(createPageSession()).current
  const pageContent = useRef<HTMLDivElement>(null)
  const pageRef = useRef<Page>('workbench')
  const navigationRequested = useRef(false)
  const [page, setPage] = useState<Page>('workbench')
  const [settings, setSettings] = useState(false)
  const [preferences, setPreferences] = useState(loadPreferences)
  const [tour, setTour] = useState(() => loadPreferences().tutorial.tourStatus === 'unseen')
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
  const navigate = useCallback((next: Page) => {
    if (next === pageRef.current) return
    session.scroll[pageRef.current] = window.scrollY
    pageRef.current = next
    navigationRequested.current = true
    setPage(next)
  }, [session])
  // Child cleanup runs before this effect, so an old drawer cannot steal the
  // destination's focus or leave the new page inert. No transition timers gate state.
  useEffect(() => {
    if (!navigationRequested.current) return
    navigationRequested.current = false
    const heading = pageContent.current?.querySelector<HTMLElement>('h1')
    heading?.setAttribute('tabindex', '-1')
    heading?.focus({ preventScroll: true })
    window.scrollTo({ top: session.scroll[page], behavior: 'instant' })
  }, [page, session])
  async function refreshModelConfig() {
    await state.refreshConfig()
  }
  const titles = { workbench: '整理工作台', library: '资料库', history: '操作记录', help: '使用说明' }
  return <div className="app-shell" data-density={preferences.density}><Sidebar page={page} onPage={navigate} online={state.online} onTutorial={openPractice} exerciseCompleted={preferences.tutorial.exerciseCompleted} /><div className="main-shell"><header className="topbar"><div className="breadcrumb"><span>工作空间</span><ChevronRight size={13} /><strong>{titles[page]}</strong></div><button className="button settings-button" onClick={() => setSettings(true)}><Settings2 size={15} />模型设置<span className={`status-dot ${state.config?.model.configured ? 'online' : ''}`} /></button></header><main>
    {state.error ? <div className="alert error" role="alert"><CircleAlert size={18} /><span>{state.error}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => state.setError('')}><X size={16} /></button></div> : null}
    {state.message ? <div className="alert success" role="status"><CheckCircle2 size={18} /><span>{state.message}</span><button className="icon-button" aria-label="关闭状态提示" onClick={() => state.setMessage('')}><X size={16} /></button></div> : null}
    <div key={page} className="page-transition" ref={pageContent} data-page={page}>
      {page === 'workbench' ? <Workbench state={state} session={session.workbench} onLibrary={() => navigate('library')} onTutorial={openPractice} onHistory={() => navigate('history')} offlineFirst={preferences.offlineFirst} /> : page === 'library' ? <LibraryPage workspace={state.workspace} history={state.history} taxonomy={state.config?.taxonomy} session={session.library} onWorkbench={() => navigate('workbench')} /> : page === 'history' ? <HistoryPage state={state} /> : <HelpPage session={session.help} supportedExtensions={state.config?.supported_extensions} onPractice={openPractice} onReplayTour={() => setTour(true)} exerciseCompleted={preferences.tutorial.exerciseCompleted} />}
    </div>
    <div className="page-bottom"><span>NeatDrop 净匣</span><span>少一点杂乱，多一点从容。</span><span>LOCAL FIRST · MVP 0.1</span></div>
  </main></div>{settings ? <SettingsDialog config={state.config} onClose={() => setSettings(false)} onSaved={refreshModelConfig} preferences={preferences} onPreferencesChange={changePreferences} /> : null}
    {tour ? <FirstRunTour onClose={closeTour} onComplete={completeTour} onPractice={openPractice} /> : null}
    {practice ? <TutorialPractice onClose={closePractice} completed={preferences.tutorial.exerciseCompleted} onComplete={completePractice} /> : null}
  </div>
}
