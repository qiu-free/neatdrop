import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LibraryPage } from '../components/LibraryPage'
import { api } from './experienceApi'
import { experienceEngine } from './engine'
import type { Workspace } from '../types'
vi.mock('../api', async () => import('./experienceApi'))
vi.mock('../runtimeCapabilities', async () => import('./capabilities'))
afterEach(() => experienceEngine.reset())
it('explains browser memory when no workspace or results exist', async () => {
  const back = vi.fn(), view = render(<LibraryPage workspace={null} history={[]} onWorkbench={back} />)
  expect(screen.getByRole('heading', { name: '先载入学习文本' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回工作台选择目录' }))
  expect(back).toHaveBeenCalledOnce()
  const workspace = await api<Workspace>('/workspaces', {})
  view.rerender(<LibraryPage workspace={workspace} history={[]} onWorkbench={back} />)
  await waitFor(() => expect(screen.getByRole('heading', { name: '还没有内存整理结果' })).toBeInTheDocument())
  expect(screen.getByText(/刷新即清空/)).toBeInTheDocument()
})
