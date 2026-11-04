import { workflow, type WorkflowStage } from '../workflow'

export function WorkflowOverview({ current, label, onNavigate, working = false }: {
  current?: WorkflowStage; label: string; onNavigate?: (stage: WorkflowStage) => void; working?: boolean
}) {
  return <nav className="workflow-overview" aria-label={label}><ol>{workflow.map((step, index) => <li key={step.id} aria-current={step.id === current ? 'step' : undefined}>
    {onNavigate ? <button type="button" disabled={working && !['library', 'history'].includes(step.id)} onClick={() => onNavigate(step.id)}><span>{index + 1}</span>{step.label}</button> : <><span>{index + 1}</span>{step.label}</>}
  </li>)}</ol></nav>
}
