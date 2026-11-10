import { useState } from 'react'
import { Info, RotateCcw } from 'lucide-react'
import './experience.css'

export function ExperienceBanner() {
  const [expanded, setExpanded] = useState(false)
  return <section className="experience-banner" aria-label="网页体验说明">
    <div><Info size={19} aria-hidden="true" /><strong>网页体验</strong><span>文本在浏览器计算，不写入你的文件夹</span><button type="button" className="text-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起说明' : '能力说明'}</button><button type="button" className="text-button" onClick={() => { if (confirm('清空本页内存中的资料、建议和整理结果？原始文件不会改变。')) location.reload() }}><RotateCcw size={14} />清空体验</button></div>
    {expanded ? <p>学习文本使用未校准的结构规则生成候选，图谱按实际词项计算。合成图片展示真实本地处理的预录记录，网页不运行 OCR。自选文本不上传，刷新即清空。真实文件复制、撤回和图片识别请运行本地完整版；此页“加入资料库”和“移除结果”只改变浏览器内存。</p> : null}
  </section>
}
