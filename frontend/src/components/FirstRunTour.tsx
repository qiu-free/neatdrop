import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Modal } from './Modal'
import './tutorial.css'

const steps = [
  { title: '先从工作台开始', text: '选择一个本机目录，或在帮助练习里使用内置样例。NeatDrop 只列出当前目录的文件，不进入子目录。' },
  { title: '查看和选择是两件事', text: '点文件名可以查看内容；勾选框才会把它加入本批整理。查看文件不会自动选中。' },
  { title: '先分析，再逐项复核', text: '本地识别无需网络。信息不足的结果会标记待复核；修改名称或分类后，再看一遍建议是否合适。' },
  { title: '确认后生成可撤回副本', text: '先检查目标计划，再明确确认。系统保留原件；符合条件时，可以从操作记录撤回归档副本。' },
]

export interface FirstRunTourProps {
  onClose: () => void
  onPractice?: () => void
}

export function FirstRunTour({ onClose, onPractice }: FirstRunTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const safeIndex = Math.min(steps.length - 1, Math.max(0, stepIndex))
  const step = steps[safeIndex]

  return <Modal title="新手导览" onClose={onClose}>
      <section className="learning-tour" aria-describedby="tour-copy">
      <header className="learning-tour-head"><span>NeatDrop · 新手导览</span></header>
      <div className="learning-tour-art" aria-hidden="true"><span className="tour-paper"><i /><i /><i /></span><span className="tour-check">✓</span></div>
      <div className="learning-tour-progress"><span>第 {safeIndex + 1} 步，共 {steps.length} 步</span><div aria-hidden="true">{steps.map((_, index) => <i key={index} className={index <= safeIndex ? 'active' : ''} />)}</div></div>
      <h2>{step.title}</h2><p id="tour-copy">{step.text}</p>
      <footer className="learning-tour-actions">
        <button className="text-button" onClick={onClose}>跳过导览</button>
        <span>
          <button className="button secondary" onClick={() => setStepIndex(index => index - 1)} disabled={safeIndex === 0}><ArrowLeft size={15} />上一步</button>
          {safeIndex === steps.length - 1
            ? <>
                {onPractice ? <button className="button secondary" onClick={() => { onClose(); onPractice() }}>去做安全练习</button> : null}
                <button className="button primary" onClick={onClose}>完成导览</button>
              </>
            : <button className="button primary" onClick={() => setStepIndex(index => index + 1)}>下一步<ArrowRight size={15} /></button>}
        </span>
      </footer>
      </section>
  </Modal>
}
