import { createExperienceEngine } from './engine'
import type { Workspace, Job, Plan, ExecutionSnapshot, LibraryListing } from '../types'
import type { GraphListing } from '../graphTypes'

it('runs actual analysis, confirmed memory organization and removal without network or file writes', async () => {
  const engine = createExperienceEngine()
  const ws = await engine.handle('/workspaces', { path: 'samples' }) as Workspace
  const ids = ws.files.filter(file => file.supported).slice(0, 3).map(file => file.id)
  let job = await engine.handle('/analysis-jobs', { workspace_id: ws.id, file_ids: ids, mode: 'local' }) as Job
  while (job.status === 'running' || job.status === 'queued') job = await engine.handle(`/analysis-jobs/${job.id}`) as Job
  expect(job.results).toHaveLength(3)
  expect(job.results[0].category).toBe('study')
  const plan = await engine.handle(`/workspaces/${ws.id}/plans`, { edits: job.results.map(row => ({ file_id: row.file_id, name: row.name, category: row.category, subcategory: row.subcategory })) }) as Plan
  await expect(engine.handle(`/workspaces/${ws.id}/execute`, { plan_id: plan.id, digest: plan.digest, confirmed: false })).rejects.toThrow()
  const done = await engine.handle(`/workspaces/${ws.id}/execute`, { plan_id: plan.id, digest: plan.digest, confirmed: true }) as ExecutionSnapshot
  expect(done.status).toBe('completed')
  expect((await engine.handle(`/workspaces/${ws.id}/library`) as LibraryListing).items).toHaveLength(3)
  await expect(engine.handle(`/workspaces/${ws.id}/execute`, { plan_id: plan.id, digest: plan.digest, confirmed: true })).rejects.toThrow()
  const listing = await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing
  const graphJob = await engine.handle(`/workspaces/${ws.id}/graph/jobs`, { entry_ids: listing.items.map(item => item.id), confirmed: true }) as { id: string }
  await engine.handle(`/workspaces/${ws.id}/graph/jobs/${graphJob.id}`)
  expect((await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing).relations.length).toBeGreaterThan(0)
  const edge = (await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing).relations[0]
  const evidence = await engine.handle(`/workspaces/${ws.id}/graph/relations/${encodeURIComponent(edge.id)}/evidence`) as { relation: { id: string } }
  expect(evidence.relation.id).toBe(edge.id)
  await engine.handle(`/workspaces/${ws.id}/transactions/${done.transaction!.id}/undo`, { confirmed: true })
  expect((await engine.handle(`/workspaces/${ws.id}/library`) as LibraryListing).items).toHaveLength(0)
})

it('rejects wrong workspaces, unknown routes, invalid taxonomy and aborted writes', async () => {
  const engine = createExperienceEngine()
  await expect(engine.handle('/workspaces/wrong/library')).rejects.toThrow()
  await expect(engine.handle('/made-up')).rejects.toThrow()
  const ws = await engine.handle('/workspaces', { path: 'samples' }) as Workspace
  await expect(engine.handle(`/workspaces/${ws.id}/plans`, { edits: [{ file_id: ws.files[0].id, name: '../bad.txt', category: 'study' }] })).rejects.toThrow()
  const controller = new AbortController(); controller.abort()
  await expect(engine.handle('/workspaces', { path: 'samples' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('computes the actual batch continuously instead of delaying a file until each poll', async () => {
  const engine = createExperienceEngine()
  const ws = await engine.handle('/workspaces', {}) as Workspace
  const ids = ws.files.filter(file => file.supported).map(file => file.id)
  const job = await engine.handle('/analysis-jobs', { workspace_id: ws.id, file_ids: ids, mode: 'local' }) as Job
  const result = await engine.handle(`/analysis-jobs/${job.id}`) as Job
  expect(result.processed).toBe(ids.length)
  expect(result.status).toBe('completed')
})
