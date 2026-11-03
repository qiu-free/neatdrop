import { Modal } from './Modal'
import { TutorialExercise } from './TutorialExercise'

export interface TutorialPracticeProps {
  onClose: () => void
  completed: boolean
  onComplete: () => void
}

export function TutorialPractice({ onClose, completed, onComplete }: TutorialPracticeProps) {
  return <Modal title="安全练习" onClose={onClose}>
    <TutorialExercise completed={completed} onComplete={onComplete} />
  </Modal>
}
