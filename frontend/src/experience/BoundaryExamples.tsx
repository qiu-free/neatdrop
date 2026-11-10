import { useState } from 'react'
import { experienceEngine } from './engine'
import { IMPORT_PATH } from './dataset'
export function BoundaryExamples({ onLoaded, disabled }: { onLoaded: (path: string) => void; disabled: boolean }) {
  const [unsupported, setUnsupported] = useState(false)
  return <details className="recorded-examples"><summary>进阶：看看信息不足或格式不支持时会怎样</summary><button className="button secondary" disabled={disabled} onClick={() => { if (!confirm('切换到低信息例子会清空本页已有结果，原文件不变。继续？')) return; experienceEngine.installFiles([{ id: 'low-information', name: '短笔记.txt', text: '学习资料' }]); onLoaded(IMPORT_PATH) }}>载入低信息文本</button><button className="button secondary" disabled={disabled} onClick={() => setUnsupported(!unsupported)} aria-expanded={unsupported}>为什么网页不处理 PDF？</button>{unsupported ? <p role="status">PDF、Office、图片均不能加入网页实时分析。请在本地完整版授权目录后处理；网页的图片只展示标明来源的预录记录。低信息文本会保留原名、归到待分类并要求复核。</p> : null}</details>
}
