import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, StrictMode } from 'react'
import { useWorkspace } from './useWorkspace'
import { api, initSession } from './api'
import type { FileRecord, Workspace } from './types'

vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  api: vi.fn(),
  initSession: vi.fn(),
}))

const file = (id: string, size = 1): FileRecord => ({
  id, name: `${id}.md`, extension: '.md', size, modified: 1, supported: true, reason: '', sha256: id,
})
const workspace = (files: FileRecord[]): Workspace => ({ id: 'workspace', name: 'Test', path: 'C:/test', files })
let filesToScan: FileRecord[]
let configVersion: number

beforeEach(() => {
  vi.clearAllMocks()
  filesToScan = [file('a'), file('b')]
  configVersion = 1
  vi.mocked(initSession).mockResolvedValue(undefined)
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({ model: { configured: false, config_version: configVersion } }) as never
    if (path === '/workspaces') return Promise.resolve(workspace(filesToScan)) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/workspaces/workspace/plans') return Promise.resolve({ id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [] }) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
})

it('starts a scanned workspace with an explicit empty selection', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  expect(result.current.selected.size).toBe(0)
})

it('loads the session and configuration once when React Strict Mode remounts the hook', async () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(StrictMode, null, children)
  const { result } = renderHook(() => useWorkspace(), { wrapper })
  await waitFor(() => expect(result.current.online).toBe(true))
  expect(vi.mocked(initSession)).toHaveBeenCalledOnce()
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/config')).toHaveLength(1)
})

it('refreshes the model configuration after settings are saved', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  const refreshConfig = (result.current as unknown as { refreshConfig?: () => Promise<unknown> }).refreshConfig
  expect(refreshConfig).toBeTypeOf('function')
  configVersion = 2
  await act(async () => { await refreshConfig?.() })
  expect(result.current.config?.model.config_version).toBe(2)
})

it('caps a batch at 50 supported files', async () => {
  filesToScan = Array.from({ length: 51 }, (_, index) => file(String(index)))
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => { for (const item of filesToScan) result.current.toggle(item.id) })
  expect(result.current.selected.size).toBe(50)
})

it('preserves the existing selection when a file would exceed 200 MiB', async () => {
  filesToScan = [file('first', 120 * 1024 ** 2), file('too-large', 81 * 1024 ** 2)]
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('first'))
  act(() => result.current.toggle('too-large'))
  expect(result.current.selected).toEqual(new Set(['first']))
})

it('requires explicit review approval before creating a plan', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.createPlan() })
  expect(result.current.plan).toBeNull()
  expect(vi.mocked(api)).not.toHaveBeenCalledWith('/workspaces/workspace/plans', expect.anything())
})

it('requires analysis or an explicit manual edit before approval and never defaults an untouched entry to other', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.approve('a'))
  expect(result.current.reviewed.has('a')).toBe(false)
  expect(result.current.edits.a).toBeUndefined()
  act(() => result.current.toggle('a'))
  act(() => result.current.edit({ file_id: 'a', name: '课程.md', category: 'study', subcategory: 'notes' }))
  act(() => result.current.approve('a'))
  await act(async () => { await result.current.createPlan() })
  expect(result.current.plan?.id).toBe('plan')
})

it('invalidates an existing plan when setSelected changes the selection directly', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  act(() => result.current.edit({ file_id: 'a', name: 'a.md', category: 'study' }))
  act(() => result.current.approve('a'))
  await act(async () => { await result.current.createPlan() })
  expect(result.current.plan?.id).toBe('plan')

  act(() => result.current.setSelected(new Set()))

  expect(result.current.plan).toBeNull()
})

it('retains review-required files in the batch and lets the user toggle them before approval', async () => {
  const ordinary = { file_id: 'a', name: 'a.md', category: 'study', evidence: '课程笔记', review_required: false, provider: 'local_rules', sample: '' }
  const needsReview = { file_id: 'b', name: 'b.md', category: 'other', evidence: '线索不足', review_required: true, provider: 'local_rules', sample: '' }
  const completedJob = { id: 'job', status: 'completed', processed: 2, total: 2, mode: 'local', results: [ordinary, needsReview], errors: [] }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a'), file('b')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/analysis-jobs') return Promise.resolve(completedJob) as never
    if (path === '/analysis-jobs/job') return Promise.resolve(completedJob) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  act(() => result.current.toggle('b'))
  await act(async () => { await result.current.analyze('local', false) })
  expect(result.current.selected).toEqual(new Set(['a', 'b']))
  act(() => { result.current.approveSelected() })
  expect(result.current.reviewed).toEqual(new Set(['a', 'b']))
  act(() => result.current.toggle('b'))
  expect(result.current.selected).toEqual(new Set(['a']))
  expect(result.current.reviewed).toEqual(new Set(['a', 'b']))
  act(() => result.current.toggle('b'))
  expect(result.current.selected).toEqual(new Set(['a', 'b']))
  expect(result.current.reviewed.has('b')).toBe(true)
})

it('approves only selected supported analyzed or edited files without unresolved errors', async () => {
  filesToScan = [file('a'), file('b'), file('untouched'), { ...file('unsupported'), supported: false }, file('failed'), file('manual')]
  const job = { id: 'job', status: 'completed', processed: 3, total: 3, mode: 'local', results: [
    { file_id: 'a', name: '研究.md', category: 'study', review_required: true, evidence: '', provider: 'local_rules', sample: '' },
    { file_id: 'b', name: '未选择.md', category: 'office', review_required: false, evidence: '', provider: 'local_rules', sample: '' },
  ], errors: [{ file_id: 'failed', code: 'READ_FAILED' }] }
  const baseline = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation((path, ...args) => path.startsWith('/analysis-jobs') ? Promise.resolve(job) as never : baseline(path, ...args))
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  await act(async () => { await result.current.analyze('local', false, ['a', 'b', 'failed']) })
  act(() => {
    result.current.setSelected(new Set(['a', 'untouched', 'failed', 'manual', 'unsupported']))
    result.current.edit({ file_id: 'failed', name: 'failed.md', category: 'study' })
    result.current.edit({ file_id: 'manual', name: '人工.md', category: 'office' })
    result.current.edit({ file_id: 'unsupported', name: 'unsupported.md', category: 'study' })
  })
  act(() => result.current.approveSelected())
  expect(result.current.reviewed).toEqual(new Set(['a', 'manual']))
  expect(result.current.edits.untouched).toBeUndefined()
  act(() => result.current.approve('failed'))
  act(() => result.current.approve('unsupported'))
  expect(result.current.reviewed).toEqual(new Set(['a', 'manual']))
  expect(result.current.errors.failed).toBe('READ_FAILED')
})

it('preserves approvals on selection changes while keeping the viewed file unchanged', async () => {
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.setActiveId('b'))
  act(() => result.current.toggle('a'))
  expect(result.current.activeId).toBe('b')
  act(() => result.current.edit({ file_id: 'a', name: 'a.md', category: 'study' }))
  act(() => result.current.approveSelected())
  expect(result.current.reviewed.has('a')).toBe(true)
  act(() => result.current.setSelected(new Set()))
  expect(result.current.reviewed.has('a')).toBe(true)
  act(() => result.current.toggle('a'))
  expect(result.current.reviewed.has('a')).toBe(true)
})

it('removes failed files from selection when a job reports per-file errors', async () => {
  const failedJob = { id: 'job', status: 'completed', processed: 2, total: 2, mode: 'local', results: [], errors: [{ file_id: 'b', code: 'READ_FAILED' }] }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a'), file('b')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/analysis-jobs' || path === '/analysis-jobs/job') return Promise.resolve(failedJob) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  act(() => result.current.toggle('b'))

  await act(async () => { await result.current.analyze('local', false) })

  expect(result.current.selected).toEqual(new Set(['a']))
  expect(result.current.errors.b).toBe('READ_FAILED')
})

it('merges partial suggestions and current-file progress while polling', async () => {
  const suggestion = { file_id: 'a', name: 'a-ready.md', category: 'study', evidence: '正文', review_required: false, provider: 'local_rules', sample: '' }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/analysis-jobs') return Promise.resolve({ id: 'job', status: 'running', processed: 0, total: 1, mode: 'local', results: [], errors: [] }) as never
    if (path === '/analysis-jobs/job') return Promise.resolve({ id: 'job', status: 'running', processed: 1, total: 1, current_file: 'a.md', phase: 'classification', mode: 'local', results: [suggestion], errors: [] }) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.analyze('local', false) })
  expect(result.current.suggestions.a).toEqual(suggestion)
  expect(result.current.job?.current_file).toBe('a.md')
  expect(result.current.job?.phase).toBe('classification')
})

it('checks the existing execution status after a disconnected execute request without reposting', async () => {
  const plan = { id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [{ file_id: 'a', source: 'a.md', target: 'out/a.md', sha256: 'a', size: 1, stage: 'planned' }] }
  const snapshot = { plan_id: 'plan', status: 'interrupted', processed: 0, total: 1, current_file: null, items: plan.items, error: 'connection lost' }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/workspaces/workspace/plans') return Promise.resolve(plan) as never
    if (path === '/workspaces/workspace/execute') return Promise.reject(new Error('connection lost')) as never
    if (path === '/workspaces/workspace/executions/plan') return Promise.resolve(snapshot) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.edit({ file_id: 'a', name: 'a.md', category: 'other' }))
  act(() => result.current.approve('a'))
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.createPlan() })
  await act(async () => { await result.current.execute() })
  expect(vi.mocked(api)).toHaveBeenCalledWith('/workspaces/workspace/executions/plan')
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/workspaces/workspace/execute')).toHaveLength(1)
})

it('polls execution progress and completion while the execute request is still pending', async () => {
  const plan = { id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [{ file_id: 'a', source: 'a.md', target: 'out/a.md', sha256: 'a', size: 1, stage: 'planned' }] }
  const running = { plan_id: 'plan', status: 'running', processed: 0, total: 1, current_file: 'a.md', items: [{ ...plan.items[0], stage: 'copying' }], error: null }
  const completed = { plan_id: 'plan', status: 'completed', processed: 1, total: 1, current_file: null, items: [{ ...plan.items[0], stage: 'completed' }], error: null }
  let resolveExecute!: (value: unknown) => void
  let executionReads = 0
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/workspaces/workspace/plans') return Promise.resolve(plan) as never
    if (path === '/workspaces/workspace/execute') return new Promise(resolve => { resolveExecute = resolve }) as never
    if (path === '/workspaces/workspace/executions/plan') {
      executionReads += 1
      return Promise.resolve(executionReads === 1 ? running : completed) as never
    }
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.edit({ file_id: 'a', name: 'a.md', category: 'other' }))
  act(() => result.current.approve('a'))
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.createPlan() })

  vi.useFakeTimers()
  let executePromise!: Promise<void>
  act(() => { executePromise = result.current.execute() })
  try {
    expect(result.current.plan).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.execution?.status).toBe('running')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.execution?.status).toBe('completed')
    expect(executionReads).toBeGreaterThanOrEqual(2)
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/workspaces/workspace/execute')).toHaveLength(1)
  } finally {
    resolveExecute({ id: 'tx', created: '', mode: 'copy', status: 'completed', acknowledged: false, items: completed.items })
    await act(async () => { await executePromise })
    vi.useRealTimers()
  }
})

it('stops polling a planned snapshot after the execute request is rejected', async () => {
  const plan = { id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [{ file_id: 'a', source: 'a.md', target: 'out/a.md', sha256: 'a', size: 1, stage: 'planned' }] }
  const planned = { plan_id: 'plan', status: 'planned', processed: 0, total: 1, current_file: null, items: plan.items, error: null }
  let executionReads = 0
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/workspaces/workspace/plans') return Promise.resolve(plan) as never
    if (path === '/workspaces/workspace/execute') return Promise.reject(new Error('connection lost')) as never
    if (path === '/workspaces/workspace/executions/plan') {
      executionReads += 1
      return Promise.resolve(planned) as never
    }
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.edit({ file_id: 'a', name: 'a.md', category: 'other' }))
  act(() => result.current.approve('a'))
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.createPlan() })

  vi.useFakeTimers()
  try {
    await act(async () => { await result.current.execute() })
    expect(result.current.execution?.status).toBe('planned')
    expect(result.current.busy).toBe('')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(executionReads).toBe(1)
  } finally {
    vi.useRealTimers()
  }
})

it('resumes analysis by polling the same job after a progress disconnect', async () => {
  const suggestion = { file_id: 'a', name: 'a.md', category: 'study', evidence: '正文', review_required: false, provider: 'local_rules', sample: '' }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({}) as never
    if (path === '/workspaces') return Promise.resolve(workspace([file('a')])) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/analysis-jobs') return Promise.resolve({ id: 'job', status: 'running', processed: 0, total: 1, mode: 'local', results: [], errors: [] }) as never
    if (path === '/analysis-jobs/job') return Promise.reject(new Error('offline')) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  const { result } = renderHook(() => useWorkspace())
  await waitFor(() => expect(result.current.online).toBe(true))
  await act(async () => { await result.current.scan('C:/test') })
  act(() => result.current.toggle('a'))
  await act(async () => { await result.current.analyze('local', false) })
  await act(async () => { await result.current.analyze('local', false, ['a']) })
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/analysis-jobs')).toHaveLength(1)
  const resume = (result.current as unknown as { resumeAnalysis?: () => Promise<void> }).resumeAnalysis
  expect(resume).toBeTypeOf('function')
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/analysis-jobs/job') return Promise.resolve({ id: 'job', status: 'completed', processed: 1, total: 1, mode: 'local', results: [suggestion], errors: [] }) as never
    if (path === '/workspaces/workspace/transactions') return Promise.resolve([]) as never
    if (path === '/config') return Promise.resolve({}) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  await act(async () => { await resume?.() })
  expect(result.current.suggestions.a).toEqual(suggestion)
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/analysis-jobs')).toHaveLength(1)
})
