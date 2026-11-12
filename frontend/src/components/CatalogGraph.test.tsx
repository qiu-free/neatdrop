import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeGraphPage } from './KnowledgeGraphPage'
import { createGraphSession } from '../graphTypes'
import { api } from '../api'
vi.mock('../api', () => ({ api: vi.fn(), bytes: () => '10 B', explain: (value: string) => value }))
vi.mock('./GraphCanvas', () => ({ GraphCanvas: () => <div>画布</div> }))
afterEach(() => vi.resetAllMocks())

it('opens the catalog without a current workspace and previews through the catalog grant', async () => {
  const item = { id: 'composite', name: '跨目录笔记.txt', category: 'study', subcategory: 'notes', root_id: 'root', source_alias: '课程甲', workspace_id: 'other-ws', original_entry_id: 'original', availability: 'available', created: '', size: 10, target: 'notes.txt' }
  vi.mocked(api).mockImplementation(async path => path === '/catalog' ? { version: 1, revision: 0, relations_revision: 0, roots: [] } : path.endsWith('/preview') ? { text: '当前已授权副本正文', sample: 'verified' } : { items: [item], relations: [], total: 1, next_offset: null, truncated: false, index: { count: 0, revision: 0, updated: null, state: 'empty', issues: [] } })
  render(<KnowledgeGraphPage workspace={null} history={[]} session={createGraphSession()} onWorkbench={vi.fn()} onLibrary={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('图谱范围'), { target: { value: 'catalog' } })
  fireEvent.click(await screen.findByRole('button', { name: '预览 跨目录笔记.txt' }))
  expect(await screen.findByText('当前已授权副本正文')).toBeInTheDocument()
  await waitFor(() => expect(api).toHaveBeenCalledWith('/catalog/library/composite/preview', undefined, expect.any(AbortSignal)))
})
