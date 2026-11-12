import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Modal } from './Modal'
import { workflow } from '../workflow'
import { WorkflowOverview } from './WorkflowOverview'
import { OnboardingStage, onboardingSteps } from './OnboardingStage'
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

  return <Modal title="新手导览" onClose={onClose} scrollContent>
      <section className="learning-tour" aria-describedby="tour-copy">
      <header className="learning-tour-head"><span>先看建议，再确认副本；原件保留。</span></header>
      <WorkflowOverview current={step.id} label="完整整理流程" />
      <OnboardingStage stage={step.id} title={step.title} />
      <div className="learning-tour-progress"><span>第 {safeIndex + 1} 步，共 {steps.length} 步</span><div aria-hidden="true">{steps.map((_, index) => <i key={index} className={index <= safeIndex ? 'active' : ''} />)}</div></div>
      <div key={step.id} className="stage-transition"><h2>{step.title}</h2><p id="tour-copy">{onboardingSteps[step.id].task}</p><details className="tour-detail"><summary>了解这一步</summary><p>{step.text}</p></details></div>
      {onPractice && safeIndex < steps.length - 1 ? <button className="button primary tour-direct-practice" onClick={() => { onClose(); onPractice() }}>开始安全练习<ArrowRight size={15} /></button> : null}
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
