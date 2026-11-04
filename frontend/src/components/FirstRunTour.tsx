import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Modal } from './Modal'
import { workflow } from '../workflow'
import { WorkflowOverview } from './WorkflowOverview'
import './tutorial.css'

const steps = workflow

export interface FirstRunTourProps {
  onClose: () => void
  onComplete?: () => void
  onPractice?: () => void
}

export function FirstRunTour({ onClose, onComplete = onClose, onPractice }: FirstRunTourProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const safeIndex = Math.min(steps.length - 1, Math.max(0, stepIndex))
  const step = steps[safeIndex]

  return <Modal title="新手导览" onClose={onClose}>
      <section className="learning-tour" aria-describedby="tour-copy">
      <header className="learning-tour-head"><span>NeatDrop · 新手导览</span></header>
      <WorkflowOverview current={step.id} label="完整整理流程" />
      <div className="learning-tour-art" aria-hidden="true"><span className="tour-paper"><i /><i /><i /></span><span className="tour-check">✓</span></div>
      <div className="learning-tour-progress"><span>第 {safeIndex + 1} 步，共 {steps.length} 步</span><div aria-hidden="true">{steps.map((_, index) => <i key={index} className={index <= safeIndex ? 'active' : ''} />)}</div></div>
      <div key={step.id} className="stage-transition"><h2>{step.title}</h2><p id="tour-copy">{step.text}</p></div>
      <footer className="learning-tour-actions">
        <button className="text-button" onClick={onClose}>跳过导览</button>
        <span>
          <button className="button secondary" onClick={() => setStepIndex(index => index - 1)} disabled={safeIndex === 0}><ArrowLeft size={15} />上一步</button>
          {safeIndex === steps.length - 1
            ? <>
                {onPractice ? <button className="button secondary" onClick={() => { onComplete(); onPractice() }}>去做安全练习</button> : null}
                <button className="button primary" onClick={onComplete}>完成导览</button>
              </>
            : <button className="button primary" onClick={() => setStepIndex(index => index + 1)}>下一步<ArrowRight size={15} /></button>}
        </span>
      </footer>
      </section>
  </Modal>
}
