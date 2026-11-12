import { workflow, type WorkflowStage } from '../workflow'

export function WorkflowOverview({ current, label, onNavigate, working = false, blocked = {}, describedBy }: {
  current?: WorkflowStage; label: string; onNavigate?: (stage: WorkflowStage) => void; working?: boolean
  blocked?: Partial<Record<WorkflowStage, string>>; describedBy?: string
}) {
  return <nav className="workflow-overview" aria-label={label}><ol>{workflow.map((step, index) => <li key={step.id} aria-current={step.id === current ? 'step' : undefined}>
    {onNavigate ? <button type="button" disabled={!!blocked[step.id] || working} title={blocked[step.id]} aria-describedby={blocked[step.id] ? describedBy : undefined} onClick={() => { if (!blocked[step.id] && !working) onNavigate(step.id) }}><span>{index + 1}</span>{step.label}</button> : <><span>{index + 1}</span>{step.label}</>}
  </li>)}</ol></nav>
}
