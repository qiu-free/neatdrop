import { useState } from 'react'
import records from './records/results.json'
import board from './records/board.png'
import chart from './records/chart.png'
import slide from './records/slide.png'
import paper from './records/paper.png'

const images = [board, chart, slide, paper]
export function RecordedExamples() {
  const [open, setOpen] = useState<string | null>(null)
  return <section className="recorded-examples" aria-label="本地处理预录图片"><details><summary>查看4份图片的本地处理记录（预录）</summary><p>原创合成样例，CC0-1.0。2026-11-11 使用本机 RapidOCR 与生产分类规则计算，图像模型关闭。网页只展示记录，不运行图片识别；这些样例不用于准确率评测。</p><div className="recorded-grid">{records.map((row, index) => <article key={row.id}><button type="button" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}><img src={images[index]} alt={row.title} loading="lazy" /><strong>{row.title}</strong><span>预录 · {row.category_label} / {row.subcategory_label}</span></button>{open === row.id ? <div><p>本地处理 {row.elapsed_ms} ms；{row.suggestion.review_required ? '仍需人工复核' : '普通建议，仍由人工确认'}。耗时来自当前开发机，不能代表其他设备。</p><pre>{row.text || '没有识别出可靠文字。'}</pre><p>{row.sampling.summary}</p><small>文件 SHA-256：{row.sha256}</small></div> : null}</article>)}</div></details></section>
}
