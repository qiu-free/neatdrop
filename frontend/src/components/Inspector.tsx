import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Quote, ScanText, Eye, X, ZoomIn, ZoomOut, Maximize, ShieldCheck } from 'lucide-react'
import { bytes, explain } from '../api'
import { requestPreview } from '../previewRequests'
import { reviewReasons, type Category, type ClassificationCandidate, type Edit, type EvidenceItem, type FileRecord, type Preview, type Suggestion } from '../types'
import { useTaxonomy } from '../taxonomy'
import { CategoryPicker } from './CategoryPicker'
import { FileIcon } from './FileTable'
import { ContentQuality } from './ContentQuality'
import { RecognitionRecovery } from './RecognitionRecovery'
import { isWebExperience } from '../runtimeCapabilities'

const decisionLabels = { ordinary: '普通建议', candidate: '待复核候选', abstain: '暂不判断用途' } as const
const evidenceLabels: Record<string, string> = { title: '标题', body: '正文', filename: '文件名', ocr: 'OCR', visual: '视觉', semantic: '语义', structure: '结构' }
const imageTypeLabels: Record<string, string> = { scatter_plot: '散点图', line_chart: '折线图', bar_chart: '柱状图', histogram: '直方图', pie_chart: '饼图', heatmap: '热图', box_plot: '箱线图', flowchart: '流程图', table_image: '表格影像', diagram: '结构图' }

function isCategory(value: unknown, categories: Record<string, string>): value is Category {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(categories, value)
}

function validCandidates(candidates: ClassificationCandidate[] = [], categories: Record<string, string>, subcategories: Record<string, Record<string, string>>) {
  const seen = new Set<string>()
  const valid: ClassificationCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate || !isCategory(candidate.category, categories)) continue
    if (candidate.subcategory !== null && (typeof candidate.subcategory !== 'string' ||
      !Object.prototype.hasOwnProperty.call(subcategories[candidate.category], candidate.subcategory))) continue
    const key = `${candidate.category}/${candidate.subcategory ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    valid.push(candidate)
    if (valid.length === 3) break
  }
  return valid
}

function evidenceLocation(item: EvidenceItem) {
  const location = item.location ?? item
  if (Number.isInteger(location.page) && location.page! > 0) return `第 ${location.page} 页`
  if (Number.isInteger(location.slide) && location.slide! > 0) return `第 ${location.slide} 张幻灯片`
  const parts: string[] = []
  if (typeof location.sheet === 'string' && location.sheet) parts.push(`工作表“${location.sheet}”`)
  if (typeof location.cell === 'string' && /^[A-Z]{1,3}[1-9]\d{0,6}$/i.test(location.cell)) parts.push(`单元格 ${location.cell}`)
  if (Number.isInteger(location.table) && location.table! > 0) parts.push(`第 ${location.table} 个表格`)
  if (Number.isInteger(location.row) && location.row! > 0) parts.push(`第 ${location.row} 行`)
  if (Number.isInteger(location.paragraph) && location.paragraph! > 0) parts.push(`第 ${location.paragraph} 段`)
  if (parts.length) return parts.join(' · ')
  if (Array.isArray(location.box) && location.box.length) return '图像局部区域'
  if (Number.isInteger(location.start) && Number.isInteger(location.end) && location.start! >= 0 && location.end! > location.start!) {
    return `字符 ${location.start! + 1}–${location.end}`
  }
  return ''
}

export function Inspector({ workspaceId, workspacePath, file, suggestion, edit, onEdit, position, total, onPrevious, onNext, checked = false, editingDisabled = false, editingHint, reviewed = false, onApprove, onClose, drawerOpen = false, analysisError, previewEnabled = true, config, onCreateRule, onRetry, onRescan, onSettings, onHelp }: {
  workspaceId: string; workspacePath?: string; file: FileRecord; suggestion?: Suggestion; edit?: Edit; onEdit: (edit: Edit) => void
  position?: number; total?: number; onPrevious?: () => void; onNext?: () => void; checked?: boolean
  editingDisabled?: boolean; editingHint?: string; reviewed?: boolean; onApprove?: () => void; onClose?: () => void; drawerOpen?: boolean
  analysisError?: string; previewEnabled?: boolean; config?: import('../types').Config | null
  onCreateRule?: (seed: { fileId: string; category: string; subcategory: string | null }) => void
  onRetry?: () => void; onRescan?: () => void; onSettings?: () => void; onHelp?: (topic: string) => void
}) {
  const { taxonomy, categories, subcategories, contentForms } = useTaxonomy()
  const [manualFocus, setManualFocus] = useState(false)
  const [loaded, setLoaded] = useState<{ key: string; preview: Preview | null; error: string } | null>(null)
  const previews = useRef(new Map<string, Preview>())
  const identity = `${workspaceId}/${file.id}/${file.sha256 ?? file.modified}`
  const canPreview = file.supported || isWebExperience && file.reason === 'WEB_RECORDED_PREVIEW'
  const [zoom, setZoom] = useState({ identity, scale: 1 })
  const scale = zoom.identity === identity ? zoom.scale : 1
  const zoomTo = (value: number) => setZoom({ identity, scale: Math.min(3, Math.max(1, value)) })
  useEffect(() => { previews.current.clear() }, [workspaceId])
  useEffect(() => {
    if (!previewEnabled || previews.current.has(identity)) return
    let ignore = false
    const controller = new AbortController()
    if (canPreview) requestPreview(`/workspaces/${workspaceId}/files/${file.id}/preview`, controller.signal)
      .then(data => {
        if (ignore) return
        // Session-local bounded cache, keyed by workspace and exact file bytes.
        // Never retain the previous file on screen while another preview loads.
        const cost = (value: Preview) => 2 * ((value.image?.length ?? 0) + (value.text?.length ?? 0))
        if (cost(data) <= 8 * 1024 * 1024) {
          previews.current.set(identity, data)
          while (previews.current.size > 8 || [...previews.current.values()].reduce((sum, entry) => sum + cost(entry), 0) > 8 * 1024 * 1024) {
            previews.current.delete(previews.current.keys().next().value!)
          }
        }
        setLoaded({ key: identity, preview: data, error: '' })
      })
      .catch(err => { if (!ignore && err.name !== 'AbortError') setLoaded({ key: identity, preview: null, error: err.message }) })
    return () => { ignore = true; controller.abort() }
  }, [workspaceId, file.id, canPreview, identity, previewEnabled])
  const preview = loaded?.key === identity ? loaded.preview : previews.current.get(identity) ?? null
  const error = loaded?.key === identity ? loaded.error : ''
  const name = edit?.name ?? suggestion?.name ?? file.name
  const currentCategory = edit?.category ?? suggestion?.category
  const category = isCategory(currentCategory, categories) ? currentCategory : 'other'
  const currentSubtype = edit ? edit.subcategory : suggestion?.subcategory
  const subtype = typeof currentSubtype === 'string' && Object.prototype.hasOwnProperty.call(subcategories[category], currentSubtype) ? currentSubtype : null
  const candidates = validCandidates(suggestion?.candidates, categories, subcategories)
  const group = taxonomy[category]
  const relativePath = group ? `${group.directory}${subtype ? `/${group.subcategories[subtype]}` : ''}/${name}` : '请选择归档分类'
  const destination = workspacePath ? `${workspacePath.replace(/[\\/]$/, '')}/${relativePath}` : relativePath
  const ruleConflict = suggestion?.review_reasons?.includes('personal_rule_conflict') ?? false
  const decisionLevel = ruleConflict ? (category === 'other' ? 'abstain' : 'candidate') : suggestion?.decision_level ?? (suggestion?.review_required ? 'candidate' : 'ordinary')
  const sampling = suggestion?.sampling ?? preview?.sampling
  const imageTypes = suggestion?.tags?.filter(tag => Object.hasOwn(imageTypeLabels, tag)).map(tag => imageTypeLabels[tag]) ?? []
  const change = (patch: Partial<Edit>) => onEdit({ file_id: file.id, name, category, subcategory: subtype ?? null, ...patch })
  return <aside id="file-details" className="inspector" aria-label="文件详情" role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen ? true : undefined} tabIndex={-1}><div className="inspector-heading"><span><Eye size={15} />当前文件详情</span><div className="detail-navigation"><button className="icon-button" aria-label="上一个文件" disabled={!onPrevious || position === 0} onClick={onPrevious}><ChevronLeft size={17} /></button>{total ? <span>{(position ?? 0) + 1} / {total}</span> : null}<button className="icon-button" aria-label="下一个文件" disabled={!onNext || position === (total ?? 1) - 1} onClick={onNext}><ChevronRight size={17} /></button>{onClose ? <button className="icon-button close-detail" aria-label="关闭文件详情" onClick={onClose}><X size={17} /></button> : null}</div></div>
    <div className="inspector-file" aria-live="polite"><FileIcon file={file} /><div><strong title={file.name}>{file.name}</strong><small>{bytes(file.size)} · {file.extension.slice(1).toUpperCase()} · {checked ? '已勾选待整理' : '仅查看，未勾选'}</small></div></div>
    {file.supported ? <>
      <div className="preview"><div className="preview-caption"><ScanText size={13} />本地内容预览</div><div className={`preview-stage ${scale > 1 ? 'zoomed' : ''}`} role="region" aria-label="内容预览" aria-live="polite" aria-busy={!preview && !error}>{error ? <p className="preview-error">{error}</p> : preview?.image ? <img key={identity} src={preview.image} style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, maxHeight: 'none' }} alt={`${file.name} 的本地缩略预览`} /> : preview?.text ? <pre>{preview.text.slice(0, 650)}</pre> : <p>读取中…</p>}</div>{preview?.image ? <div className="preview-controls"><button type="button" className="icon-button" aria-label="缩小预览" disabled={scale <= 1} onClick={() => zoomTo(scale - .25)}><ZoomOut size={16} /></button><output aria-label="预览缩放">{scale === 1 ? '适应窗口' : `${Math.round(scale * 100)}%`}</output><button type="button" className="icon-button" aria-label="放大预览" disabled={scale >= 3} onClick={() => zoomTo(scale + .25)}><ZoomIn size={16} /></button><button type="button" className="icon-button" aria-label="适应窗口" onClick={() => zoomTo(1)}><Maximize size={16} /></button></div> : null}</div>
      {suggestion?.content_form ? <div className="classification-form" aria-label="识别到的内容"><span>识别到什么</span><strong>{contentForms[suggestion.content_form] ?? '内容类型待核对'}{imageTypes.length ? ` · 可能为${imageTypes.join('、')}` : ''}</strong></div> : null}
      {suggestion ? <div className="classification-decision"><span className={`decision-badge ${decisionLevel}`}>{decisionLabels[decisionLevel]}</span>{category !== 'other' && subtype === null ? <p>主分类已有依据，二级分类待确认；可仅按主分类归档。</p> : null}</div> : null}
      {suggestion?.personal_rule_matches?.length ? <section className="personal-rule-evidence" aria-label="个人规则依据"><strong><ShieldCheck size={15} />个人规则候选，仍需复核</strong>{suggestion.personal_rule_matches.map(rule => <p key={rule.id}>{rule.name} · 命中关键词：{rule.keywords.join('、')}</p>)}{suggestion.personal_rule_evidence ? <small>{suggestion.personal_rule_evidence}</small> : null}</section> : null}
      {suggestion && !reviewed ? <p className="review-task" aria-label="本项核对任务">{category === 'other' ? '请选择归档分类，或按原名称归到待分类。' : '核对内容与归档位置，再确认此项。'}</p> : null}
      <ContentQuality quality={suggestion?.quality} />
      <div className="copy-destination"><strong>建议放哪里</strong><p aria-label="归档副本位置">{destination}</p><small>{isWebExperience ? '这里是浏览器整理结果中的建议位置；不会创建磁盘副本。' : '确认后在此生成副本，原件保留。最终路径以整理计划为准。'}</small></div><fieldset className="inspector-fields" disabled={editingDisabled}><CategoryPicker key={identity} category={category} subcategory={subtype} disabled={editingDisabled} onChange={(nextCategory, nextSubtype) => change({ category: nextCategory, subcategory: nextSubtype })} /><label htmlFor="suggested-name">归档副本名称<span>{editingDisabled ? editingHint ?? '分析中，稍后编辑' : '可编辑'}</span></label><input id="suggested-name" value={name} maxLength={150} onChange={e => change({ name: e.target.value })} /></fieldset>
      {manualFocus ? <button type="button" className="button secondary manual-classification-focus" onClick={() => document.querySelector<HTMLElement>('.inspector-fields select')?.focus()}>聚焦归档分类</button> : null}
      {candidates.length ? <div className="classification-candidates" role="group" aria-label="其他可能的归档用途"><h3>其他可能的归档用途</h3><p>选择候选会更新分类，仍需逐项确认。</p><div className="candidate-list">{candidates.map(candidate => {
        const label = `${categories[candidate.category]} / ${candidate.subcategory === null ? '仅按主分类归档' : subcategories[candidate.category][candidate.subcategory]}`
        return <button key={`${candidate.category}/${candidate.subcategory ?? ''}`} type="button" className="candidate-choice"
          aria-label={`选择候选：${label}`} disabled={editingDisabled}
          onClick={() => change({ category: candidate.category, subcategory: candidate.subcategory })}>
          <strong>{label}</strong>{candidate.evidence ? <span>{candidate.evidence}</span> : null}
        </button>
      })}</div></div> : null}
      <details className="recognition-details"><summary>识别详情与读取范围</summary>
      {sampling ? <section className="classification-sampling" aria-label="读取范围"><h3>读取范围</h3><p>{sampling.summary || '读取范围未提供，请核对原文件。'}</p>{sampling.truncated || sampling.budget_exhausted ? <p className="sampling-warning">{sampling.budget_exhausted ? '已达到本地处理预算；' : ''}本文件未完整读取，请确认归档用途。</p> : null}</section> : null}
      <div className="evidence"><Quote size={16} /><div><strong>{suggestion?.provider === 'cloud_model' ? '云端模型依据' : suggestion?.provider === 'offline_semantic' ? '本地语义依据' : suggestion?.provider === 'offline_models' ? '离线内容依据' : suggestion ? '多证据规则依据' : '等待分析或手动编辑'}</strong><p>{suggestion?.evidence ?? (editingDisabled ? '完成本地分析并进入复核步骤后，可编辑归档名称与分类。编辑结果仍需逐项审核，再独立确认整理计划。' : '可编辑归档名称与分类；保存后仍需逐项审核，再独立确认整理计划。')}</p>{suggestion?.evidence_items?.length ? <ul className="evidence-list">{suggestion.evidence_items.slice(0, 5).map((item, i) => <li key={i}><span>{evidenceLabels[item.source] ?? '内容线索'}</span>{item.text}{evidenceLocation(item) ? <small className="evidence-location">{evidenceLocation(item)}</small> : null}</li>)}</ul> : null}{suggestion ? <small>{suggestion.review_required ? (suggestion.review_reasons?.map(r => reviewReasons[r] ?? (r === 'personal_rule_conflict' ? '多个个人规则给出不同目标，需人工复核' : '此项需要人工复核')).join('；') || '信息不足，请人工复核。') : '这是建议，不代表已执行。'}</small> : null}{suggestion?.engine_warnings?.length ? <small className="engine-warning">部分本地识别能力受限，请结合原文件核对。</small> : null}</div></div>
      </details>
      {suggestion && reviewed && onCreateRule ? <button type="button" className="button secondary personal-rule-seed" disabled={editingDisabled} onClick={() => onCreateRule({ fileId: file.id, category, subcategory: subtype })}><ShieldCheck size={15} />为类似文件建立规则</button> : null}
      {analysisError || suggestion?.review_required ? <RecognitionRecovery file={file} suggestion={suggestion} error={analysisError} config={config} onRetry={onRetry && onClose ? () => { onClose(); onRetry() } : onRetry} onRescan={onRescan && onClose ? () => { onClose(); onRescan() } : onRescan} onSettings={onSettings && onClose ? () => { onClose(); onSettings() } : onSettings} onHelp={onHelp && onClose ? topic => { onClose(); onHelp(topic) } : onHelp} onManual={() => setManualFocus(true)} /> : null}
      {analysisError ? <p className="review-task">分析错误尚未处理：{explain(analysisError)}。请先重新分析此项。</p> : null}
      <div className={`individual-approval ${reviewed ? 'approved' : ''}`}><span>{reviewed ? '已确认此项' : suggestion || edit ? '确认当前分类与名称' : '尚未分析，请先分析或编辑分类与名称。'}</span><button className="button secondary" disabled={editingDisabled || reviewed || !onApprove || !!analysisError || !suggestion && !edit} aria-pressed={reviewed} onClick={onApprove}>{reviewed ? '已确认此项' : analysisError ? '处理错误后确认' : suggestion || edit ? '逐项确认此项' : '先分析或编辑后确认'}</button></div>
      <p className="inspector-note">始终保留原扩展名；修改只影响待确认计划。</p>
    </> : <div className="notice muted">{explain(file.reason)}。原文件保持不变。{canPreview ? <div className="preview"><p>{preview?.sample}</p>{preview?.image ? <img src={preview.image} alt={`${file.name} 的预录原图`} style={{ width: '100%', height: 'auto' }} /> : null}<pre style={{ whiteSpace: 'pre-wrap' }}>{preview?.text}</pre></div> : null}</div>}
  </aside>
}
