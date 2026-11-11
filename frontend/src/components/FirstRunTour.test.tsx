import { fireEvent, render, screen } from '@testing-library/react'
import { FirstRunTour } from './FirstRunTour'

it('introduces all six workflow stages including library and completes only by an explicit final action', () => {
  const onClose = vi.fn(), onComplete = vi.fn(), onPractice = vi.fn()
  render(<FirstRunTour onClose={onClose} onComplete={onComplete} onPractice={onPractice} />)
  expect(screen.getByText('第 1 步，共 6 步')).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: '完整整理流程' })).toHaveTextContent('资料库')
  expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
  for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByRole('heading', { name: '操作记录与撤回' })).toBeInTheDocument()
  expect(onComplete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '去做安全练习' }))
  expect(onComplete).toHaveBeenCalledOnce()
  expect(onPractice).toHaveBeenCalledOnce()
  expect(onClose).not.toHaveBeenCalled()
})

it('skipping or Escape does not report completion', () => {
  const onClose = vi.fn(), onComplete = vi.fn()
  render(<FirstRunTour onClose={onClose} onComplete={onComplete} />)
  fireEvent.click(screen.getByRole('button', { name: '跳过导览' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(onComplete).not.toHaveBeenCalled()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(onComplete).not.toHaveBeenCalled()
})

it('lets a newcomer start hands-on practice immediately without marking the unread tour complete', () => {
  const onClose = vi.fn(), onComplete = vi.fn(), onPractice = vi.fn()
  render(<FirstRunTour onClose={onClose} onComplete={onComplete} onPractice={onPractice} />)
  const pictures = new Set<string | null>()
  for (let index = 0; index < 6; index++) {
    pictures.add(screen.getByRole('img', { name: /阶段示意图/ }).getAttribute('src'))
    if (index < 5) fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  }
  expect(pictures.size).toBe(6)
  for (let index = 0; index < 5; index++) fireEvent.click(screen.getByRole('button', { name: '上一步' }))
  fireEvent.click(screen.getByRole('button', { name: '直接动手练习' }))
  expect(onPractice).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
  expect(onComplete).not.toHaveBeenCalled()
})
