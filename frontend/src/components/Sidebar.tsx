import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Archive, FolderOpen, Library, History, BookOpen, ShieldCheck, ArrowUpRight, Network, PanelLeftClose, PanelLeftOpen, HardDrive, Monitor } from 'lucide-react'
import type { Page, Workspace } from '../types'
import { isWebExperience } from '../runtimeCapabilities'

const destinations = [
  { key: 'workbench', label: '整理工作台', icon: FolderOpen },
  { key: 'library', label: '资料库', icon: Library },
  { key: 'graph', label: '知识图谱', icon: Network },
  { key: 'history', label: '操作记录', icon: History },
  { key: 'help', label: '使用说明', icon: BookOpen },
] as const

interface SidebarProps {
  page: Page
  onPage: (page: Page) => void
  online: boolean
  exerciseCompleted?: boolean
  workspace?: Workspace | null
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ page, onPage, online, exerciseCompleted = false, workspace, collapsed = false, onToggle }: SidebarProps) {
  const hintPrefix = useId()
  const [hint, setHint] = useState<{ id: string; text: string; top: number; left: number } | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedHint = useRef<string | null>(null)
  const hoveredHint = useRef<string | null>(null)
  const tooltipHovered = useRef(false)
  const supported = workspace?.files.filter(file => file.supported).length ?? 0
  const directories = workspace?.files.filter(file => file.reason === 'DIRECTORY_SKIPPED').length ?? 0
  const total = (workspace?.files.length ?? 0) - directories
  const status = isWebExperience ? '浏览器内存运行 · 不写入文件夹' : online ? '本地服务已连接' : '正在连接本地服务'
  const toggleLabel = collapsed ? '展开侧边栏' : '收起侧边栏'

  function cancelDismiss() {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
    dismissTimer.current = null
  }
  function hideHint() {
    cancelDismiss()
    focusedHint.current = null
    hoveredHint.current = null
    tooltipHovered.current = false
    setHint(null)
  }
  function scheduleDismiss(id: string) {
    cancelDismiss()
    dismissTimer.current = setTimeout(() => {
      if (focusedHint.current !== id && hoveredHint.current !== id && !tooltipHovered.current) {
        setHint(current => current?.id === id ? null : current)
      }
    }, 120)
  }
  function hintProps(key: string, text: string) {
    const id = `${hintPrefix}-${key}`
    const show = (event: FocusEvent<HTMLElement> | MouseEvent<HTMLElement>) => {
      if (!collapsed) return
      cancelDismiss()
      const bounds = event.currentTarget.getBoundingClientRect()
      setHint({ id, text, top: Math.max(8, Math.min(bounds.top + bounds.height / 2 - 22, window.innerHeight - 60)), left: bounds.right + 12 })
    }
    return {
      'aria-describedby': hint?.id === id ? id : undefined,
      onFocus: (event: FocusEvent<HTMLElement>) => { focusedHint.current = id; show(event) },
      onBlur: () => { if (focusedHint.current === id) focusedHint.current = null; scheduleDismiss(id) },
      onMouseEnter: (event: MouseEvent<HTMLElement>) => { hoveredHint.current = id; show(event) },
      onMouseLeave: () => { if (hoveredHint.current === id) hoveredHint.current = null; scheduleDismiss(id) },
    }
  }
  useEffect(() => {
    setHint(null)
    return () => { if (dismissTimer.current !== null) clearTimeout(dismissTimer.current) }
  }, [collapsed])
  useEffect(() => {
    if (!hint) return
    const dismiss = () => {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current)
      focusedHint.current = null
      hoveredHint.current = null
      tooltipHovered.current = false
      setHint(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', escape)
    }
  }, [hint])

  return <aside className="sidebar sidebar-glass" data-collapsed={collapsed} aria-label="工作空间导航">
    <div className="sidebar-header">
      <a href="#" className="brand" aria-label="NeatDrop 整理工作台" {...hintProps('brand', 'NeatDrop · 整理工作台')} onClick={event => { event.preventDefault(); hideHint(); onPage('workbench') }}>
        <span className="brand-mark"><Archive size={23} strokeWidth={1.7} aria-hidden="true" /></span>
        <span className="sidebar-brand-name">NeatDrop</span>
      </a>
      <button type="button" className="sidebar-toggle" aria-label={toggleLabel} aria-expanded={!collapsed} aria-controls="workspace-sidebar-content" {...hintProps('toggle', toggleLabel)} onClick={() => { hideHint(); onToggle?.() }}>
        {collapsed ? <PanelLeftOpen size={19} aria-hidden="true" /> : <PanelLeftClose size={19} aria-hidden="true" />}
      </button>
    </div>
    <p className="sidebar-tagline">净匣 · 让文件各得其所</p>
    <div id="workspace-sidebar-content" className="sidebar-content" onScroll={hideHint}>
      <span className="nav-label">我的工作空间</span>
      <nav aria-label="主导航">{destinations.map(item => <button key={item.key} type="button" className={page === item.key ? 'nav-active' : ''} aria-current={page === item.key ? 'page' : undefined} {...hintProps(item.key, `${item.label}${item.key === 'help' && exerciseCompleted ? ' · 已完成安全练习' : ''}`)} onClick={() => { hideHint(); onPage(item.key) }}>
        <item.icon size={19} strokeWidth={1.7} aria-hidden="true" />
        <span className="nav-item-label">{item.label}</span>
        {item.key === 'help' && exerciseCompleted ? <span className="practice-nav-badge">已练习</span> : null}
        {page === item.key && !(item.key === 'help' && exerciseCompleted) ? <span className="nav-dot" aria-hidden="true" /> : null}
      </button>)}</nav>

      <section className="sidebar-workspace" aria-label="当前目录概况" key={workspace?.id ?? 'empty'}>
        <h2><HardDrive size={16} aria-hidden="true" />{isWebExperience ? '当前资料' : '当前目录'}</h2>
        {workspace ? <>
          <strong className="sidebar-workspace-name">{workspace.name}</strong>
          <dl className="sidebar-file-counts">
            <div><dt>已扫描文件</dt><dd>{total}</dd></div>
            <div><dt>支持分析</dt><dd>{supported}</dd></div>
          </dl>
          {total > supported ? <p className="sidebar-unsupported">{total - supported} 个文件暂不支持分析</p> : null}
          {directories > 0 ? <p className="sidebar-unsupported">{directories} 个子文件夹未扫描</p> : null}
          {!isWebExperience ? <details className="sidebar-directory-path"><summary>查看目录路径</summary><p>{workspace.path}</p></details> : null}
        </> : <><strong className="sidebar-workspace-name">{isWebExperience ? '尚未选择资料' : '尚未选择目录'}</strong><p>{isWebExperience ? '选择示例或导入文本后，在这里查看资料概况。' : '在工作台选择目录后，这里会显示文件概况。'}</p></>}
      </section>

      <div className="sidebar-bottom">
        <div className="safety-note">
          <div className="sidebar-safety-heading"><ShieldCheck size={20} strokeWidth={1.7} aria-hidden="true" /><strong>原件始终保留</strong></div>
          <ul className="sidebar-safety-points">{isWebExperience ? <><li>仅在浏览器内整理</li><li>可导出整理清单</li></> : <><li>分析后由你复核分类</li><li>确认后才生成副本</li><li>整理记录随时可查</li></>}</ul>
          <button type="button" aria-label="查看整理安全说明" {...hintProps('safety', '原件始终保留 · 查看整理安全说明')} onClick={() => { hideHint(); onPage('help') }}>
            <ShieldCheck className="sidebar-safety-icon" size={20} aria-hidden="true" /><span className="sidebar-safety-link">查看整理安全说明</span><ArrowUpRight className="sidebar-safety-arrow" size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="local-status">
          <span className={`status-dot ${online ? 'online' : ''}`} aria-hidden="true" />
          <span className="sidebar-status-label">{status}</span><span className="sidebar-version">v0.1</span>
        </div>
        <span className="sidebar-status-icon" role="img" tabIndex={0} aria-label={status} {...hintProps('status', status)}><Monitor size={19} aria-hidden="true" /><span className={`status-dot ${online ? 'online' : ''}`} aria-hidden="true" /></span>
      </div>
    </div>
    {hint && collapsed ? createPortal(<div id={hint.id} role="tooltip" className="sidebar-icon-hint" style={{ top: hint.top, left: hint.left }} onMouseEnter={() => { tooltipHovered.current = true; cancelDismiss() }} onMouseLeave={() => { tooltipHovered.current = false; scheduleDismiss(hint.id) }}>{hint.text}</div>, document.body) : null}
  </aside>
}
