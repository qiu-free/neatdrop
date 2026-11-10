import { useEffect, useState } from 'react'
import { ArrowRight, ShieldCheck, LoaderCircle } from 'lucide-react'
import { Modal } from './Modal'
import type { Plan } from '../types'
import { isWebExperience } from '../runtimeCapabilities'

export function PlanDialog({ plan, busy, onConfirm, onClose }: {
  plan: Plan; busy: boolean; onConfirm: () => void; onClose: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => setConfirmed(false), [plan.id])
  return <Modal title="确认这一次整理" onClose={onClose} busy={busy}>
    <div className="notice"><ShieldCheck size={20} /><div><strong>{isWebExperience ? '只加入浏览器体验资料库' : '只生成副本，不改动原件'}</strong><p>{isWebExperience ? '以下为内存中的分类位置，没有复制磁盘文件。刷新或清空体验后移除，可在资料库导出整理清单。' : '目标文件独占创建，SHA-256 校验后记录结果。若存在同名或文件已变化，该项会停止。'}</p></div></div>
    <div className="plan-items">{plan.items.map(item => <div className="plan-item" key={item.file_id}><span>{item.source}</span><ArrowRight size={15} /><strong>{item.target}</strong></div>)}</div>
    <label className="check-line"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /><span>{isWebExperience ? `我已核对以上 ${plan.items.length} 项分类与名称，同意加入内存资料库；此操作不会创建真实文件。` : `我已核对以上 ${plan.items.length} 项路径，同意生成归档副本。原件和副本都会占用磁盘空间。`}</span></label>
    <footer className="modal-footer"><button className="button secondary" onClick={onClose} disabled={busy}>返回修改</button><button className="button primary" onClick={onConfirm} disabled={!confirmed || busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{isWebExperience ? busy ? '正在加入…' : '确认加入体验资料库' : busy ? '正在复制与校验…' : '确认生成归档副本'}</button></footer>
  </Modal>
}
