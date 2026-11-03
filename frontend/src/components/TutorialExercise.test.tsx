import { fireEvent, render, screen } from '@testing-library/react'
import { TutorialExercise } from './TutorialExercise'

it('completes all six sample tasks in memory and raises only the completion callback', () => {
  const onComplete = vi.fn()
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  render(<TutorialExercise completed={false} onComplete={onComplete} />)

  expect(screen.getByText('演练模式')).toBeInTheDocument()
  expect(screen.getByText(/不会读取本机文件，也不会访问 API/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '载入内置样例' }))
  expect(screen.getByText('演示收据.png')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '查看 演示收据.png' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 演示收据.png' }))
  expect(screen.getByText('当前查看：演示收据.png')).toBeInTheDocument()
  expect(screen.getByText('已选择 1 个示例')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续：做一次本地分析' }))

  fireEvent.click(screen.getByRole('button', { name: '模拟本地分析' }))
  expect(screen.getByText(/模拟建议：票据凭证/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('练习分类'), { target: { value: '生活服务' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '我已阅读模拟依据并标记复核' }))
  fireEvent.click(screen.getByRole('button', { name: '保存修改并复核' }))
  expect(screen.getByText(/模拟分类已更新为\s*生活服务/)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('checkbox', { name: '我已确认模拟归档' }))
  fireEvent.click(screen.getByRole('button', { name: '模拟确认并生成副本' }))
  expect(screen.getByText('模拟结果：已生成归档副本')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '模拟撤回副本' }))

  expect(screen.getByText(/模拟已撤回，原件仍保留/)).toBeInTheDocument()
  expect(onComplete).toHaveBeenCalledOnce()
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
})

it('shows the persisted practice badge when the exercise was completed before', () => {
  render(<TutorialExercise completed onComplete={() => undefined} />)
  expect(screen.getByText('练习已完成')).toBeInTheDocument()
})

it('keeps each sample checkbox and the batch count in sync', () => {
  render(<TutorialExercise completed={false} onComplete={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: '载入内置样例' }))

  const receipt = screen.getByRole('checkbox', { name: '选择 演示收据.png' })
  const notes = screen.getByRole('checkbox', { name: '选择 课程笔记.md' })
  fireEvent.click(notes)
  expect(notes).toBeChecked()
  expect(receipt).not.toBeChecked()
  expect(screen.getByText('已选择 1 个示例')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续：做一次本地分析' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: '查看 演示收据.png' }))
  fireEvent.click(receipt)
  expect(receipt).toBeChecked()
  expect(screen.getByText('已选择 2 个示例')).toBeInTheDocument()
  fireEvent.click(notes)
  expect(notes).not.toBeChecked()
  expect(screen.getByText('已选择 1 个示例')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续：做一次本地分析' })).toBeEnabled()
})
