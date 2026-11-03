import { fireEvent, render, screen } from '@testing-library/react'
import { FirstRunTour } from './FirstRunTour'

it('shows a skippable four-step tour and offers the safe practice at the end', () => {
  const onClose = vi.fn()
  const onPractice = vi.fn()
  render(<FirstRunTour onClose={onClose} onPractice={onPractice} />)

  expect(screen.getByRole('dialog', { name: '新手导览' })).toBeInTheDocument()
  expect(screen.getByText('先从工作台开始')).toBeInTheDocument()
  expect(screen.getByText('第 1 步，共 4 步')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步' }))
  expect(screen.getByText('确认后生成可撤回副本')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '完成导览' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '去做安全练习' }))
  expect(onPractice).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})

it('can be skipped at any time', () => {
  const onClose = vi.fn()
  render(<FirstRunTour onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: '跳过导览' }))
  expect(onClose).toHaveBeenCalledOnce()
})
