import { FileText, Image, FileArchive, FileQuestion, Check, CircleAlert } from 'lucide-react'
import { bytes, explain } from '../api'
import { type Edit, type FileRecord, type Filter, type Suggestion } from '../types'
import { useTaxonomy } from '../taxonomy'
import { visibleFiles } from '../fileSelection'

export function FileIcon({ file }: { file: FileRecord }) {
  const ext = file.extension.toLowerCase()
  const Icon = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? Image : ext === '.zip' ? FileArchive : file.supported ? FileText : FileQuestion
  return <span className={`file-icon ${ext === '.pdf' ? 'terracotta' : ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? 'blue' : !file.supported ? 'gray' : ''}`}><Icon size={20} strokeWidth={1.6} /></span>
}

export function FileTable({ files, suggestions, edits, selected, activeId, filter, query, errors, reviewed = new Set(), onSelect, onActive, selectionDisabled = false }: {
  files: FileRecord[]; suggestions: Record<string, Suggestion>; edits: Record<string, Edit>
  selected: Set<string>; activeId: string | null; filter: Filter; query: string; errors: Record<string, string>
  reviewed?: ReadonlySet<string>
  onSelect: (id: string) => void; onActive: (id: string) => void
  selectionDisabled?: boolean
}) {
  const { categories, subcategories, contentForms } = useTaxonomy()
  const rows = visibleFiles(files, suggestions, edits, selected, filter, query, errors, reviewed)
  return <div className="table-scroll"><table className="file-table"><thead><tr><th className="check-cell"><span className="sr-only">选择</span></th><th>文件</th><th>分类</th><th>建议名称</th><th>状态</th></tr></thead>
    <tbody>{rows.map(file => {
      const suggestion = suggestions[file.id], edit = edits[file.id]
      const status = !file.supported ? '已跳过' : errors[file.id] ? '分析失败' : reviewed.has(file.id) ? '已确认' : edit ? '手动编辑' : suggestion?.review_required ? '待复核' : suggestion ? '待确认' : '待分析'
      const category = edit?.category ?? suggestion?.category
      const subtype = edit ? edit.subcategory : suggestion?.subcategory
      return <tr key={file.id} tabIndex={0} aria-current={activeId === file.id ? 'true' : undefined}
        className={[activeId === file.id ? 'active-row' : '', selected.has(file.id) ? 'checked-row' : ''].join(' ')}
        onClick={() => onActive(file.id)} onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onActive(file.id) } }}>
        <td className="check-cell" onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.has(file.id)} disabled={!file.supported || selectionDisabled} onChange={() => { onSelect(file.id); onActive(file.id) }} /></td>
        <td><button className="file-name-button" title={file.name}><FileIcon file={file} /><span><strong>{file.name}</strong><small>{file.extension.slice(1).toUpperCase() || '目录'}<span>·</span>{bytes(file.size)}{activeId === file.id ? <em className="viewing-label">正在查看</em> : null}</small></span></button></td>
        <td><span className={`category-tag ${category ?? 'none'}`}>{category ? (Object.hasOwn(categories, category) ? categories[category] : '分类待核对') : '—'}</span>{category && subtype ? <small className="subtype-label">{subcategories[category]?.[subtype] ?? subtype}</small> : null}{suggestion?.content_form ? <small className="form-label">{contentForms[suggestion.content_form]}</small> : null}</td>
        <td className="suggestion-cell"><button title={edit?.name ?? suggestion?.name}>{edit?.name ?? suggestion?.name ?? (file.supported ? '分析后生成，或手动编辑' : explain(file.reason))}</button></td>
        <td><span className={`status-text ${errors[file.id] || suggestion?.review_required && !reviewed.has(file.id) ? 'warning' : reviewed.has(file.id) || edit || suggestion ? 'green' : ''}`}>{errors[file.id] || suggestion?.review_required && !reviewed.has(file.id) ? <CircleAlert size={13} /> : reviewed.has(file.id) || edit || suggestion ? <Check size={13} /> : <span className="status-dot" />}{status}</span></td>
      </tr>
    })}</tbody></table>{rows.length === 0 ? <div className="empty-table">{files.length ? '没有匹配的文件' : '选择目录后，文件和整理建议会出现在这里。'}</div> : null}</div>
}
