import { Modal } from './Modal'
import { TutorialExercise } from './TutorialExercise'

export interface TutorialPracticeProps {
  onClose: () => void
  completed: boolean
  onComplete: () => void
  onStart?: () => void
}

export function TutorialPractice({ onClose, completed, onComplete, onStart }: TutorialPracticeProps) {
  return <Modal title="安全练习" onClose={onClose} scrollContent>
    <TutorialExercise completed={completed} onComplete={onComplete} onStart={onStart} />
  </Modal>
}
