import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { KnowledgeGraphPage } from './KnowledgeGraphPage'
import { createGraphSession, type GraphListing } from '../graphTypes'
import type { Workspace } from '../types'

const workspace: Workspace = { id: 'ws-keyboard', name: '键盘资料', path: 'C:\\合成资料', files: [] }
const data: GraphListing = { items: ['one', 'two'].map((id, index) => ({ id, transaction_id: 'tx', name: index ? '研究附件.txt' : '研究笔记.txt', category: 'study', subcategory: 'notes', source: `source-${id}`, target: `archive-${id}`, created: '', size: 100, availability: 'available' })), relations: [{ id: 'r1', source: 'one', target: 'two', kind: 'reference', status: 'confirmed', origin: 'manual', created: '' }], truncated: false, index: { count: 0, revision: 1, updated: null, state: 'empty', issues: [] } }
const json = (value: unknown) => ({ ok: true, json: async () => value }) as Response
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preview') ? json({ text: '合成资料预览', sample: 'utf8' }) : url.endsWith('/evidence') ? json({ relation: data.relations[0], files: [], explanation: '人工维护的关系' }) : json(data)))
})
afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })

it.each(['node', 'relation'])('returns keyboard focus to its SVG %s after closing the drawer', async kind => {
  render(<KnowledgeGraphPage workspace={workspace} history={[]} session={createGraphSession(workspace.id)} onWorkbench={vi.fn()} onLibrary={vi.fn()} />)
  await waitFor(() => expect(document.querySelector('.graph-spatial-node')).not.toBeNull())
  const trigger = kind === 'node' ? document.querySelector<SVGGElement>('.graph-spatial-node[aria-label="预览 研究笔记.txt"]')! : document.querySelector<SVGPathElement>('.graph-edge-hit')!
  act(() => trigger.focus())
  fireEvent.keyDown(trigger, { key: 'Enter' })
  await screen.findByRole('dialog')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})
