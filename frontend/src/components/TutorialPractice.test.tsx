import { fireEvent, render, screen } from '@testing-library/react'
import { TutorialPractice } from './TutorialPractice'

it('opens the in-memory exercise in a closable dialog', () => {
  const onClose = vi.fn()
  render(<TutorialPractice onClose={onClose} completed onComplete={() => undefined} />)
  expect(screen.getByRole('dialog', { name: '安全练习' })).toBeInTheDocument()
  expect(screen.getByText('练习已完成')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))
  expect(onClose).toHaveBeenCalledOnce()
})
