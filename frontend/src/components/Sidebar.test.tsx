import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

it('keeps every workspace destination available inside the glass navigation rail', () => {
  render(<Sidebar page="library" onPage={() => undefined} online />)
  const navigation = screen.getByRole('navigation', { name: '主导航' })

  expect(screen.getByRole('complementary')).toHaveClass('sidebar-glass')
  expect(navigation.querySelectorAll('button')).toHaveLength(5)
  expect(screen.queryByRole('button', { name: '产品说明' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '使用说明' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '资料库' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('原件始终保留')).toBeInTheDocument()
  expect(screen.getByText('本地服务已连接')).toBeInTheDocument()
})

it('keeps the practice shortcut out of the sidebar while preserving the help completion badge', () => {
  render(<Sidebar page="help" onPage={() => undefined} online exerciseCompleted />)
  expect(screen.getByRole('button', { name: '使用说明 已练习' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /安全练习/ })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '查看整理安全说明' })).toBeInTheDocument()
})
