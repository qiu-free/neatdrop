import { createExperienceEngine } from './engine'
import type { Workspace, Plan } from '../types'
import type { GraphListing, GraphJob } from '../graphTypes'

it('keeps a dismissed relationship dismissed after reindexing and rejects deletion of facts', async () => {
  const engine = createExperienceEngine(), ws = await engine.handle('/workspaces', {}) as Workspace
  const plan = await engine.handle(`/workspaces/${ws.id}/plans`, { edits: ws.files.slice(0, 3).map(file => ({ file_id: file.id, name: file.name, category: 'study', subcategory: 'notes' })) }) as Plan
  await engine.handle(`/workspaces/${ws.id}/execute`, { plan_id: plan.id, digest: plan.digest, confirmed: true })
  const index = async () => { const listing = await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing; const job = await engine.handle(`/workspaces/${ws.id}/graph/jobs`, { confirmed: true, entry_ids: listing.items.map(row => row.id) }) as GraphJob; await engine.handle(`/workspaces/${ws.id}/graph/jobs/${job.id}`); return await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing }
  const listing = await index(), edge = listing.relations[0]
  await engine.handle(`/workspaces/${ws.id}/graph/relations/${encodeURIComponent(edge.id)}/dismiss`, { revision: listing.index.revision })
  expect((await index()).relations.map(row => row.id)).not.toContain(edge.id)
  const updated = await engine.handle(`/workspaces/${ws.id}/graph`) as GraphListing
  await expect(engine.handle(`/workspaces/${ws.id}/graph/relations/missing`, { revision: updated.index.revision }, undefined, 'DELETE')).rejects.toThrow()
})

it('reset invalidates old routes and selecting learning samples restores original sample content', async () => {
  const engine = createExperienceEngine()
  engine.installFiles([{ id: 'mine', name: 'mine.txt', text: '我的内容' }])
  const imported = await engine.handle('/workspaces', { path: '网页体验 / 自选文本' }) as Workspace
  expect(imported.files).toHaveLength(1)
  const sample = await engine.handle('/workspaces', { path: '网页体验 / 学习资料' }) as Workspace
  expect(sample.files).toHaveLength(8)
  await expect(engine.handle(`/workspaces/${imported.id}/library`)).rejects.toThrow()
})
