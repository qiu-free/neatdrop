import { BookOpen, RotateCw, ScanLine, Settings2 } from 'lucide-react'
import type { Config, FileRecord, Suggestion } from '../types'
import { explain } from '../api'

export function RecognitionRecovery({ file, suggestion, error, config, onRetry, onRescan, onSettings, onHelp, onManual }: {
  file: FileRecord; suggestion?: Suggestion; error?: string; config?: Config | null
  onRetry?: () => void; onRescan?: () => void; onSettings?: () => void; onHelp?: (topic: string) => void; onManual?: () => void
}) {
  const reasons = suggestion?.review_reasons ?? []
  const imageFile = ['.png', '.jpg', '.jpeg', '.webp'].includes(file.extension.toLowerCase())
  const ocrUnavailable = (imageFile || file.extension.toLowerCase() === '.pdf') && config?.offline?.ocr.available === false
  const visionUnavailable = imageFile && config?.offline?.vision.available === false
  const conflict = reasons.some(reason => ['conflicting_evidence', 'competing_categories', 'personal_rule_conflict'].includes(reason))
  const incomplete = reasons.some(reason => ['partial_content', 'sampling_incomplete', 'sampling_truncated'].includes(reason))
  const title = error ? '这项分析仍有错误，处理前不能确认。' : conflict ? '不同线索给出了接近或相反的用途。' : incomplete ? '文件只读取了部分内容。' : ocrUnavailable || visionUnavailable ? '这类文件的部分本地识别能力尚不可用。' : '请结合原文件核对识别线索。'
  const reasonCopy: Record<string, string> = {
    personal_rule_conflict: '多个个人规则给出不同分类目标，系统保留原建议并要求人工复核。',
    personal_rule_applied: '个人规则提供待复核候选，不代表自动判定可靠。',
    personal_rules_unavailable: '本地规则状态不可用，基础分类建议仍可人工复核。',
    insufficient_evidence: '可读内容不足；可检查离线识别设置或直接人工分类。',
    filename_only: '当前判断线索主要来自文件名，请结合正文人工核对。',
    content_quality_limited: '内容读取质量受限，请结合原文件核对。',
    partial_content: '只读取了部分内容，请核对完整原文件。',
    sampling_incomplete: '本次读取范围不完整，请核对完整原文件。',
    sampling_truncated: '本次仅读取文件片段，请核对完整原文件。',
    vision_unavailable: '本机图片场景识别未准备好。',
    semantic_unavailable: '本地语义能力不可用，基础分类仍可人工复核。',
  }
  const recoveryText = reasons.map(reason => reasonCopy[reason]).filter(Boolean).join(' ')
  return <section className="recognition-recovery" aria-label="识别问题处理"><strong>{title}</strong>{error ? <p>{explain(error)}</p> : null}{recoveryText ? <p>{recoveryText}</p> : null}
    {ocrUnavailable || visionUnavailable ? <p>相关能力：{[ocrUnavailable ? '本地 OCR' : '', visionUnavailable ? '本地图片识别' : ''].filter(Boolean).join('、')}。图片也可能不含文字，能力不可用不代表文件异常。</p> : null}
    {onManual || onRetry || onRescan || onSettings || onHelp ? <div>{onManual ? <button className="button secondary" onClick={onManual}>按步骤手动分类</button> : null}{onRetry && (error || incomplete) ? <button className="button secondary" onClick={onRetry}><RotateCw size={14} />明确重试此项</button> : null}{onRescan ? <button className="button secondary" onClick={onRescan}><ScanLine size={14} />重新扫描目录</button> : null}{onSettings && (ocrUnavailable || visionUnavailable || reasons.includes('semantic_unavailable')) ? <button className="button secondary" onClick={onSettings}><Settings2 size={14} />查看离线设置</button> : null}{onHelp ? <button className="text-button" onClick={() => onHelp(ocrUnavailable || visionUnavailable ? 'offline-cloud-analysis' : 'analysis-review')}><BookOpen size={14} />查看处理说明</button> : null}</div> : null}
  </section>
}
