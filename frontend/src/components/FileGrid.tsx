import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, CircleAlert, Eye } from 'lucide-react'
import { requestPreview } from '../previewRequests'
import type { Edit, FileRecord, Suggestion } from '../types'
import { FileIcon } from './FileTable'
import './file-grid.css'

export interface FileGridProps {
  workspaceId: string
  files: FileRecord[]
  suggestions: Record<string, Suggestion>
  edits: Record<string, Edit>
  selected: Set<string>
  activeId: string | null
  reviewed: ReadonlySet<string>
  errors: Record<string, string>
  taxonomy?: Record<string, { label: string; directory: string; subcategories: Record<string, string> }>
  selectionDisabled?: boolean
  onSelect: (id: string) => void
  onActive: (id: string) => void
}

function Thumbnail({ workspaceId, file, identity }: { workspaceId: string; file: FileRecord; identity: string }) {
  const element = useRef<HTMLSpanElement>(null)
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ identity: string; image?: string; failed: boolean } | null>(null)
  useEffect(() => {
    if (nearViewport || !element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setNearViewport(true)
        observer.disconnect()
      }
    }, { rootMargin: '160px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [nearViewport])
  useEffect(() => {
    if (!nearViewport) return
    let ignore = false
    const controller = new AbortController()
    void requestPreview(`/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(file.id)}/preview`, controller.signal)
      .then(preview => {
        if (!ignore && !controller.signal.aborted) setLoaded({ identity, image: preview.image, failed: !preview.image })
      }).catch(() => {
        if (!ignore && !controller.signal.aborted) setLoaded({ identity, failed: true })
      })
    return () => { ignore = true; controller.abort() }
  }, [nearViewport, workspaceId, file.id, identity])
  const current = loaded?.identity === identity ? loaded : null
  return <span className="file-grid-preview" ref={element} aria-busy={nearViewport && !current}>
    {current?.image && !current.failed ? <img key={identity} src={current.image} alt={`${file.name} 的缩略图`} decoding="async" onError={() => setLoaded({ identity, failed: true })} /> : <span className="file-grid-placeholder"><FileIcon file={file} /><span>{current?.failed ? '预览不可用' : nearViewport ? '预览读取中…' : '图片预览'}</span></span>}
  </span>
}

export function FileGrid({ workspaceId, files, suggestions, edits, selected, activeId, reviewed, errors, taxonomy, selectionDisabled = false, onSelect, onActive }: FileGridProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    let destination = index
    if (event.key === 'Home') destination = 0
    else if (event.key === 'End') destination = files.length - 1
    else if (event.key === 'ArrowLeft') destination = Math.max(0, index - 1)
    else if (event.key === 'ArrowRight') destination = Math.min(files.length - 1, index + 1)
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const firstTop = buttons.current.get(files[0].id)?.getBoundingClientRect().top
      const nextRow = files.findIndex(file => {
        const top = buttons.current.get(file.id)?.getBoundingClientRect().top
        return top !== undefined && firstTop !== undefined && Math.abs(top - firstTop) > 1
      })
      const columns = nextRow > 0 ? nextRow : 1
      const nextIndex = index + (event.key === 'ArrowDown' ? columns : -columns)
      if (nextIndex >= 0 && nextIndex < files.length) destination = nextIndex
    } else return
    event.preventDefault()
    const target = files[destination]
    buttons.current.get(target.id)?.focus({ preventScroll: true })
    if (destination !== index) onActive(target.id)
  }
  return <div className="file-grid-region">
    <ul className="file-grid" aria-label="文件网格">{files.map((file, index) => {
      const suggestion = suggestions[file.id], edit = edits[file.id]
      const category = edit?.category ?? suggestion?.category
      const subtype = edit ? edit.subcategory : suggestion?.subcategory
      const categoryLabel = category ? taxonomy?.[category]?.label ?? category : '尚未分类'
      const subtypeLabel = category && subtype ? taxonomy?.[category]?.subcategories[subtype] ?? subtype : ''
      const label = subtypeLabel ? `${categoryLabel} / ${subtypeLabel}` : categoryLabel
      const confirmed = reviewed.has(file.id)
      const warning = Boolean(errors[file.id] || suggestion?.review_required && !confirmed)
      const status = !file.supported ? '已跳过' : errors[file.id] ? '分析失败' : confirmed ? '已确认' : edit ? '修改待确认' : suggestion?.review_required ? '待复核' : suggestion ? '待确认' : '待分析'
      const isImage = file.supported && ['.png', '.jpg', '.jpeg', '.webp'].includes(file.extension.toLowerCase())
      const identity = JSON.stringify([workspaceId, file.id, file.sha256 ?? `${file.modified}:${file.size}`])
      const active = activeId === file.id
      const checked = selected.has(file.id)
      return <li key={file.id} className={`file-grid-card${active ? ' is-active' : ''}${checked ? ' is-selected' : ''}`}>
        <button type="button" className="file-grid-view" aria-label={`查看 ${file.name}`} aria-current={active ? 'true' : undefined}
          ref={button => { if (button) buttons.current.set(file.id, button); else buttons.current.delete(file.id) }}
          onClick={event => { event.currentTarget.focus({ preventScroll: true }); onActive(file.id) }} onKeyDown={event => navigate(event, index)}>
          {isImage ? <Thumbnail key={identity} workspaceId={workspaceId} file={file} identity={identity} /> : <span className="file-grid-preview file-grid-document"><FileIcon file={file} /><span>{file.extension.slice(1).toUpperCase() || '文件'}</span></span>}
          <span className="file-grid-info"><strong title={file.name}>{file.name}</strong><span className="file-grid-category" title={label}>{label}</span></span>
          <span className="file-grid-view-label"><Eye size={14} aria-hidden="true" />{active ? '正在查看' : '查看详情'}</span>
        </button>
        <div className="file-grid-footer"><label className={`file-grid-select${!file.supported || selectionDisabled ? ' is-disabled' : ''}`}>
          <input type="checkbox" aria-label={`选择 ${file.name}`} checked={checked} disabled={!file.supported || selectionDisabled} onChange={() => { if (file.supported && !selectionDisabled) onSelect(file.id) }} /><span>{checked ? '已选择' : '选择'}</span>
        </label><span className={`file-grid-status${warning ? ' warning' : confirmed ? ' confirmed' : ''}`}>
          {warning ? <CircleAlert size={14} aria-hidden="true" /> : confirmed ? <Check size={14} aria-hidden="true" /> : <span className="file-grid-status-dot" />}{status}
        </span></div>
      </li>
    })}</ul>
    {files.length === 0 ? <p className="file-grid-empty">没有匹配的文件</p> : null}
  </div>
}
