import { createExperienceEngine } from './engine'
import { runTextTask } from './workerClient'
import type { Workspace, Job } from '../types'

vi.mock('./workerClient', () => ({ runTextTask: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('coalesces simultaneous polling and rejects a cancelled poll without advancing the job', async () => {
  const engine = createExperienceEngine(), ws = await engine.handle('/workspaces', {}) as Workspace
  const job = await engine.handle('/analysis-jobs', { workspace_id: ws.id, file_ids: [ws.files[0].id], mode: 'local' }) as Job
  let resolve!: (value: unknown) => void
  vi.mocked(runTextTask).mockImplementation(() => new Promise(done => { resolve = done as (value: unknown) => void }) as ReturnType<typeof runTextTask>)
  const controller = new AbortController()
  const first = engine.handle(`/analysis-jobs/${job.id}`, undefined, controller.signal)
  const second = engine.handle(`/analysis-jobs/${job.id}`)
  controller.abort()
  resolve({ file_id: ws.files[0].id, category: 'study' })
  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const result = await second as Job
  expect(runTextTask).toHaveBeenCalledTimes(1)
  expect(result.processed).toBeLessThanOrEqual(1)
  expect(result.results.length).toBeLessThanOrEqual(1)
})
