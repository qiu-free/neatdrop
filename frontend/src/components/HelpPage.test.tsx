import { fireEvent, render, screen } from '@testing-library/react'
import { HelpPage } from './HelpPage'

it('filters searchable local help topics and starts a replayable tour', () => {
  const onReplayTour = vi.fn()
  const onPractice = vi.fn()
  render(<HelpPage onReplayTour={onReplayTour} onPractice={onPractice} exerciseCompleted />)

  expect(screen.getByRole('img', { name: '先选择一个工作目录' })).toHaveAttribute('src', '/help/folder.svg')
  expect(screen.getByText('练习已完成')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索使用说明' }), { target: { value: '撤回' } })
  expect(screen.getByRole('heading', { name: '副本撤回' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '会话与费用' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新开始导览' }))
  expect(onReplayTour).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: '开始安全练习' }))
  expect(onPractice).toHaveBeenCalledOnce()
  const search = screen.getByRole('searchbox', { name: '搜索使用说明' })
  fireEvent.change(search, { target: { value: '照片' } })
  expect(screen.getByRole('heading', { name: '照片、文档和分类' })).toBeInTheDocument()
  fireEvent.change(search, { target: { value: '离线与云端' } })
  expect(screen.getByRole('heading', { name: '离线与云端分析' })).toBeInTheDocument()
})

it('explains when a search finds no local topic', () => {
  render(<HelpPage />)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索使用说明' }), { target: { value: '不存在的主题' } })
  expect(screen.getByText('没有找到相关说明。可以试试“目录”“复核”或“撤回”。')).toBeInTheDocument()
})

it('provides an accessible topic directory that moves focus to the selected help topic', () => {
  render(<HelpPage />)
  const link = screen.getByRole('link', { name: '批量核对和分类' })
  const targetSelector = link.getAttribute('href')!

  expect(screen.getByRole('navigation', { name: '帮助目录' })).toContainElement(link)
  fireEvent.click(link)
  expect(document.querySelector(targetSelector)).toHaveFocus()
})
