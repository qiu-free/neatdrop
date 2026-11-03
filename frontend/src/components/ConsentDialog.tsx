import { useState } from 'react'
import { Cloud, HardDrive, ShieldCheck } from 'lucide-react'
import { Modal } from './Modal'
import type { Config, ModelBinding } from '../types'

export function ConsentDialog({ count, config, onClose, onStart, initialMode = 'local' }: {
  count: number; config: Config | null; onClose: () => void; onStart: (mode: 'local' | 'cloud', consent: boolean, binding?: ModelBinding) => void
  initialMode?: 'local' | 'cloud'
}) {
  const [mode, setMode] = useState<'local' | 'cloud'>(initialMode)
  const [consent, setConsent] = useState(false)
  const [binding] = useState<ModelBinding>(() => ({ endpoint: config?.model.endpoint, config_version: config?.model.config_version }))
  return <Modal title={`分析 ${count} 个所选文件`} onClose={onClose}>
    <p className="modal-description">分析只生成建议，不会复制、重命名或移动文件。</p>
    <div className="analysis-options"><label className={mode === 'local' ? 'chosen' : ''}><input type="radio" name="mode" value="local" checked={mode === 'local'} onChange={() => setMode('local')} /><HardDrive size={21} /><span><strong>离线智能分类</strong><small>多证据文本规则 + 中文 OCR + 本地图片模型。不发送文件，无网络请求。</small></span></label>
      <label className={mode === 'cloud' ? 'chosen' : ''}><input type="radio" name="mode" value="cloud" checked={mode === 'cloud'} disabled={!config?.model.configured} onChange={() => setMode('cloud')} /><Cloud size={21} /><span><strong>云端模型 <em>{config?.model.configured ? '已配置' : '未配置'}</em></strong><small>图片缩略图 ≤1024px，文本片段 ≤1500 字符。不发送完整原件、路径或摘要。</small></span></label></div>
    {mode === 'cloud' ? <><p className="fine-print">发送至 {binding.endpoint ?? '当前配置的模型服务'}（配置版本 {binding.config_version ?? '当前版本'}），受服务商数据政策约束。每文件最多一次请求，无自动重试；本批上限 {config?.model.max_requests_per_batch} 次。费用按服务商实际计费。</p><label className="check-line"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>我已排除敏感文件，允许发送选中文件的预览图或抽样文本。</span></label></> : <div className="notice"><ShieldCheck size={18} /><span>OCR {config?.offline?.ocr.available ? '已就绪' : '不可用'} · 图片模型 {config?.offline?.vision.available ? '已安装' : '未安装'}。冲突或低证据项需人工复核，模型相似度不是准确率。</span></div>}
    <footer className="modal-footer"><button className="button secondary" onClick={onClose}>返回</button><button className="button primary" disabled={mode === 'cloud' && !consent} onClick={() => onStart(mode, consent, mode === 'cloud' ? binding : undefined)}>开始分析</button></footer>
  </Modal>
}
