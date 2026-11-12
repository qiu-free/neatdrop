import { indexCatalog } from './catalogIndexing'
import type { LibraryItem } from './types'

const item = (id: string, workspaceId = 'ws-one') => ({ id, workspace_id: workspaceId, original_entry_id: id } as LibraryItem)
const json = (value: unknown) => ({ ok: true, json: async () => value }) as Response
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => vi.unstubAllGlobals())

it('reconciles and cancels a server job whose create response arrives after abort', async () => {
  let finishCreate!: (response: Response) => void
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); calls.push(url)
    if (url.endsWith('/graph/jobs')) return new Promise<Response>(resolve => { finishCreate = resolve })
    if (url.endsWith('/job-late/cancel')) return Promise.resolve(json({ id: 'job-late', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [] }))
    throw new Error(`Unexpected request ${url}`)
  }))
  const controller = new AbortController()
  const task = indexCatalog([item('one')], controller.signal, vi.fn(), vi.fn())
  await tick()
  controller.abort()
  await tick()
  finishCreate(json({ id: 'job-late', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] }))
  await expect(task).resolves.toMatchObject({ id: 'job-late', status: 'cancelled' })
  expect(calls).toContain('/api/v1/workspaces/ws-one/graph/jobs/job-late/cancel')
  expect(calls.some(url => url.endsWith('/job-late'))).toBe(false)
})

it('does not dispatch another root after cancellation starts while the current root cancels', async () => {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
    const url = String(input); calls.push(url)
    if (url.endsWith('/graph/jobs')) return Promise.resolve(json({ id: 'job-one', status: 'running', processed: 0, total: 1, current_file: 'one.txt', errors: [] }))
    if (url.endsWith('/job-one/cancel')) return Promise.resolve(json({ id: 'job-one', status: 'cancelled', processed: 0, total: 1, current_file: null, errors: [] }))
    throw new Error(`Unexpected request ${url}`)
  }))
  const controller = new AbortController()
  const paths: (string | null)[] = []
  const task = indexCatalog([item('one', 'ws-one'), item('two', 'ws-two')], controller.signal, vi.fn(), path => { paths.push(path); if (path) controller.abort() })
  await expect(task).resolves.toMatchObject({ id: 'job-one', status: 'cancelled' })
  expect(calls).toContain('/api/v1/workspaces/ws-one/graph/jobs/job-one/cancel')
  expect(calls.filter(url => url.endsWith('/graph/jobs'))).toHaveLength(1)
  expect(paths).toContain('/workspaces/ws-one/graph/jobs/job-one')
})
