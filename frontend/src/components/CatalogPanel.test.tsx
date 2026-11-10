import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CatalogPanel } from './CatalogPanel'
import type { Workspace } from '../types'
import { api } from '../api'

vi.mock('../api', () => ({ api: vi.fn() }))
const workspace = { id: 'draft-ws', name: '当前课程', path: 'C:/synthetic', files: [] } as Workspace
const registry = { version: 1, revision: 4, relations_revision: 6, roots: [{ id: 'old-root', alias: '已登记课程', status: 'pending_reauthorization', manual_relation_count: 2 }] }
afterEach(() => vi.resetAllMocks())

it('registers only the explicit current workspace and does not reopen the workbench', async () => {
  vi.mocked(api).mockResolvedValue(registry)
  const changed = vi.fn()
  render(<CatalogPanel workspace={workspace} onChanged={changed} />)
  expect(await screen.findByText('待重新授权')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '将当前目录加入资料集合' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/catalog/roots', { workspace_id: 'draft-ws', alias: '当前课程', confirmed: true }, expect.any(AbortSignal)))
  expect(changed).toHaveBeenCalled()
})

it('reauthorizes a selected locator without switching the active draft', async () => {
  vi.mocked(api).mockImplementation(async path => path === '/pick-directory' ? { path: 'C:/reselected' } : path === '/workspaces' ? { ...workspace, id: 'other-ws' } : registry)
  render(<CatalogPanel workspace={workspace} onChanged={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '重新授权 已登记课程' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/catalog/roots', { workspace_id: 'other-ws', alias: '已登记课程', root_id: 'old-root', confirmed: true }, expect.any(AbortSignal)))
  expect(screen.getByText('当前工作台：当前课程')).toBeInTheDocument()
})
