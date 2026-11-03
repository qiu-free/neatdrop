import { CircleAlert, ScanText } from 'lucide-react'
import type { ContentQualityReport } from '../types'

const issueLabels: Record<string, string> = {
  no_readable_text: '没有可用的文档文字', text_garbled: '文字含不可读或乱码内容',
  ocr_low_confidence: '部分 OCR 文字识别不够可靠', partial_read: '仅读取了部分内容',
  low_information_image: '图片内容信息较少',
}
const metricLabels = { text_chars: '已提取文字', readable_chars: '可读字符', replacement_chars: '替换字符', ocr_lines: 'OCR 文字行' } as const

export function ContentQuality({ quality }: { quality?: ContentQualityReport }) {
  if (!quality) return null
  const state = ['acceptable', 'limited', 'unavailable'].includes(quality.state) ? quality.state : 'unknown'
  const issues = [...new Set(Array.isArray(quality.issues) ? quality.issues : [])]
    .filter(issue => typeof issue === 'string' && Object.hasOwn(issueLabels, issue))
  const metrics = Object.entries(metricLabels).flatMap(([key, label]) => {
    const value = quality.metrics?.[key as keyof typeof metricLabels]
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? [{ key, label, value }] : []
  })
  const title = state === 'acceptable' ? '内容已读取' : state === 'limited' ? '读取受限' : state === 'unavailable' ? '未提取到可用内容' : '读取状态待核对'
  const Icon = state === 'acceptable' ? ScanText : CircleAlert
  const nextStep = state === 'acceptable' ? '读取状态不代表归档用途已确认。'
    : state === 'unavailable' ? '请核对原文件，手动选择分类并保留合适的名称。'
      : issues.includes('ocr_low_confidence') ? '请结合原图核对文字，再确认分类与名称。'
        : issues.includes('partial_read') ? '只读取了部分内容，请结合原文件核对整体用途。'
          : '请结合原文件核对内容，再确认分类与名称。'
  return <section className={`content-quality ${state}`} aria-label="内容读取质量">
    <header><Icon size={16} aria-hidden="true" /><strong>{title}</strong><span>内容读取质量</span></header>
    <p>{typeof quality.summary === 'string' && quality.summary.trim() ? quality.summary : '本次读取状态需要人工核对。'}</p>
    <p className="quality-next-step">{nextStep}</p>
    {issues.length || metrics.length ? <details><summary>查看读取信息</summary>
      {issues.length ? <ul>{issues.map(issue => <li key={issue}>{issueLabels[issue]}</li>)}</ul> : null}
      {metrics.length ? <div className="quality-metrics">{metrics.map(metric => <p key={metric.key}>{metric.label}：{metric.value} {metric.key === 'ocr_lines' ? '行' : '字符'}</p>)}</div> : null}
      <small>仅描述内容读取情况，不表示分类正确性。</small>
    </details> : null}
  </section>
}
