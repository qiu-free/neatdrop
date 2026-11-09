import { Archive, FolderOpen, Library, History, BookOpen, ShieldCheck, ArrowUpRight, Network } from 'lucide-react'
import type { Page } from '../types'
import './tutorial.css'

export function Sidebar({ page, onPage, online, onTutorial, exerciseCompleted = false }: {
  page: Page; onPage: (page: Page) => void; online: boolean; onTutorial?: () => void; exerciseCompleted?: boolean
}) {
  return <aside className="sidebar sidebar-glass"><a href="#" className="brand" onClick={event => { event.preventDefault(); onPage('workbench') }}><span className="brand-mark"><Archive size={23} strokeWidth={1.7} /></span><span>NeatDrop<small>净匣 · 让文件各得其所</small></span></a>
    <span className="nav-label">我的工作空间</span><nav aria-label="主导航">{([{ key: 'workbench', label: '整理工作台', icon: FolderOpen }, { key: 'library', label: '资料库', icon: Library }, { key: 'graph', label: '知识图谱', icon: Network }, { key: 'history', label: '操作记录', icon: History }, { key: 'help', label: '使用说明', icon: BookOpen }] as const).map(item => <button key={item.key} className={page === item.key ? 'nav-active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => onPage(item.key)}><item.icon size={18} strokeWidth={1.6} aria-hidden="true" /><span className="nav-item-label">{item.label}</span>{item.key === 'help' && exerciseCompleted ? <span className="practice-nav-badge">已练习</span> : null}{page === item.key && !(item.key === 'help' && exerciseCompleted) ? <span className="nav-dot" /> : null}</button>)}</nav>
    <div className="sidebar-bottom"><div className="safety-note"><ShieldCheck size={23} strokeWidth={1.5} /><strong>整理有序，原件安心</strong><p>先看建议，再做决定。<br />每次整理，都有迹可循。</p><button onClick={() => onPage('help')}>了解安全模式 <ArrowUpRight size={13} /></button>{onTutorial ? <button className="sidebar-tutorial-button" onClick={onTutorial}>试做安全练习{exerciseCompleted ? <span className="practice-nav-badge">已练习</span> : null}</button> : null}</div><div className="local-status"><span className={`status-dot ${online ? 'online' : ''}`} />{online ? '本地服务已连接' : '正在连接本地服务'}<span>v0.1</span></div></div>
  </aside>
}
