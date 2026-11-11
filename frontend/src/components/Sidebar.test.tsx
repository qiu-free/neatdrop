import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

it('keeps every workspace destination available inside the glass navigation rail', () => {
  render(<Sidebar page="library" onPage={() => undefined} online />)
  const navigation = screen.getByRole('navigation', { name: '主导航' })

  expect(screen.getByRole('complementary')).toHaveClass('sidebar-glass')
  expect(navigation.querySelectorAll('button')).toHaveLength(6)
  expect(screen.getByRole('button', { name: '产品说明' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '资料库' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('整理有序，原件安心')).toBeInTheDocument()
  expect(screen.getByText('本地服务已连接')).toBeInTheDocument()
})

it('shows the persisted exercise badge and opens the practice from the sidebar', () => {
  const onTutorial = vi.fn()
  render(<Sidebar page="help" onPage={() => undefined} online onTutorial={onTutorial} exerciseCompleted />)
  expect(screen.getAllByText('已练习').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /试做安全练习/ }))
  expect(onTutorial).toHaveBeenCalledOnce()
})
