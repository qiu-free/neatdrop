import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach } from 'vitest'
import { Workbench } from './Workbench'
import type { useWorkspace } from '../useWorkspace'
import { api } from '../api'
import type { Config, ExecutionSnapshot, FileRecord, Plan, Suggestion, Workspace } from '../types'

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn() }))

const state = {
  workspace: null,
  selected: new Set<string>(),
  busy: '',
  config: null,
  suggestions: {},
  edits: {},
  errors: {},
  activeId: null,
  online: true,
  setActiveId: vi.fn(),
  setError: vi.fn(),
} as unknown as ReturnType<typeof useWorkspace>

const files: FileRecord[] = ['a', 'b', 'c'].map(id => ({ id, name: `${id}.md`, extension: '.md', size: 100, modified: 1, supported: true, reason: '', sha256: id }))
const workspace: Workspace = { id: 'w', name: 'Test', path: 'C:/test', files }
const configuredConfig = {
  model: { configured: true, endpoint: 'https://model.example/v1', config_version: 4, max_requests_per_batch: 10 },
  execution_supported: true, demo_path: '', categories: {},
  offline: { ocr: { available: false }, vision: { available: false } },
} as unknown as Config
const reviewSuggestion: Suggestion = { file_id: 'a', name: 'a.md', category: 'other', evidence: '线索不足', review_required: true, provider: 'local_rules', sample: '' }
const originalWidth = window.innerWidth

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    ...state,
    workspace,
    selected: new Set(['a']),
    busy: '',
    config: configuredConfig,
    suggestions: {},
    edits: {},
    errors: {},
    reviewed: new Set<string>(),
    activeId: 'a',
    plan: null,
    execution: null,
    job: null,
    toggle: vi.fn(),
    setSelected: vi.fn(),
    setActiveId: vi.fn(),
    edit: vi.fn(),
    approve: vi.fn(),
    approveOrdinary: vi.fn(),
    approveSelected: vi.fn(),
    analyze: vi.fn(),
    scan: vi.fn(),
    rescan: vi.fn(),
    createPlan: vi.fn(),
    execute: vi.fn(),
    cancel: vi.fn(),
    resumeAnalysis: vi.fn(),
    checkExecution: vi.fn(),
    historyAction: vi.fn(),
    refreshHistory: vi.fn(),
    setPlan: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useWorkspace>
}

it('allows selecting visible review items but requires approval before planning', () => {
  const current = makeState({ suggestions: { a: reviewSuggestion }, selected: new Set() })
  render(<Workbench state={current} />)
  fireEvent.click(screen.getByRole('button', { name: '选择可见项' }))
  expect(current.setSelected).toHaveBeenCalledWith(new Set(['a', 'b', 'c']))
  fireEvent.click(within(screen.getByRole('navigation', { name: '整理步骤' })).getByRole('button', { name: /复核/ }))
  expect(screen.getByRole('button', { name: '生成整理计划' })).toBeDisabled()
  expect(screen.getByText(/副本位置：当前文件夹内的分类子目录/)).toBeInTheDocument()
})

it('keeps workflow stage changes disabled during active work while library navigation remains available', () => {
  const onLibrary = vi.fn()
  render(<Workbench state={makeState({ busy: 'analysis' })} onLibrary={onLibrary} />)
  const navigation = screen.getByRole('navigation', { name: '整理步骤' })
  for (const name of [/选择/, /分析/, /复核/, /计划与复制/]) expect(within(navigation).getByRole('button', { name })).toBeDisabled()
  fireEvent.click(within(navigation).getByRole('button', { name: /资料库/ }))
  expect(onLibrary).toHaveBeenCalledOnce()
})

beforeEach(() => {
  vi.mocked(api).mockReset().mockImplementation((_path, _body, signal) => new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('Preview request canceled', 'AbortError'))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  }))
})

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
})

it('shows a focused empty landing with an optional practice entry and no file table', () => {
  const onTutorial = vi.fn()
  render(<Workbench state={state} onTutorial={onTutorial} />)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '进入教程演练' }))
  expect(onTutorial).toHaveBeenCalledOnce()
})

it('returns from a fixed plan dialog to review instead of a blank results view', () => {
  const plan: Plan = { id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [] }
  const workspace: Workspace = { id: 'w', name: 'Test', path: 'C:/test', files: [] }
  function Harness() {
    const [openPlan, setOpenPlan] = useState<Plan | null>(plan)
    const currentState = { ...state, workspace, plan: openPlan, setPlan: setOpenPlan, execution: null } as unknown as ReturnType<typeof useWorkspace>
    return <Workbench state={currentState} />
  }
  render(<Harness />)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回修改' }))
  expect(screen.getByRole('heading', { name: /检查建议并确认/ })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('requires confirmation before rescanning clears current drafts', async () => {
  const rescan = vi.fn().mockResolvedValue(undefined)
  const workspace: Workspace = { id: 'w', name: 'Test', path: 'C:/test', files: [] }
  const currentState = { ...state, workspace, plan: null, execution: null, rescan } as unknown as ReturnType<typeof useWorkspace>
  render(<Workbench state={currentState} />)
  fireEvent.click(screen.getByRole('button', { name: '重新扫描目录' }))
  expect(screen.getByRole('dialog', { name: '重新扫描并清除当前草稿？' })).toBeInTheDocument()
  expect(rescan).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '清除草稿并继续' }))
  await waitFor(() => expect(rescan).toHaveBeenCalledOnce())
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('shows polled execution results after confirmation while the execute request is pending', async () => {
  const plan: Plan = { id: 'pending-plan', digest: 'digest', created: '', mode: 'copy', items: [{ file_id: 'a', source: 'a.md', target: 'out/a.md', sha256: 'a', size: 100, stage: 'planned' }] }
  const progress: ExecutionSnapshot = { plan_id: plan.id, status: 'running', processed: 0, total: 1, current_file: 'a.md', items: [{ ...plan.items[0], stage: 'copying' }], error: null }
  let finishExecute!: () => void
  function Harness() {
    const [currentPlan, setPlan] = useState<Plan | null>(plan)
    const [execution, setExecution] = useState<ExecutionSnapshot | null>(null)
    const [busy, setBusy] = useState('')
    function execute() {
      setPlan(null)
      setExecution(progress)
      setBusy('execute')
      return new Promise<void>(resolve => {
        finishExecute = () => { setBusy(''); resolve() }
      })
    }
    return <Workbench state={makeState({ plan: currentPlan, setPlan, execution, busy, execute })} />
  }
  render(<Harness />)

  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('checkbox'))
  fireEvent.click(within(dialog).getByRole('button', { name: '确认生成归档副本' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('heading', { name: '正在生成归档副本' })).toBeInTheDocument()
  expect(screen.getByText('当前文件：a.md')).toBeInTheDocument()
  act(() => finishExecute())
})

it('excludes approved review-required files from the pending review filter and count', () => {
  const currentState = makeState({ suggestions: { a: reviewSuggestion }, reviewed: new Set(['a']) })
  render(<Workbench state={currentState} />)

  const reviewFilter = screen.getByRole('button', { name: /待复核/ })
  expect(reviewFilter).toHaveTextContent('0')
  fireEvent.click(reviewFilter)
  expect(screen.queryByRole('row', { name: /a\.md/ })).not.toBeInTheDocument()
})

it.each([390, 1440])('opens details only after viewing a file at width %s and restores focus after Escape', width => {
  setWidth(width)
  render(<Workbench state={makeState()} />)

  expect(screen.queryByLabelText('文件详情')).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 a.md' }))
  expect(screen.queryByRole('dialog', { name: '文件详情' })).not.toBeInTheDocument()

  const trigger = screen.getByRole('row', { name: /a\.md/ })
  trigger.focus()
  fireEvent.click(trigger)

  const drawer = screen.getByRole('dialog', { name: '文件详情' })
  expect(drawer).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('button', { name: '关闭文件详情' })).toHaveFocus()
  const next = screen.getByRole('button', { name: '下一个文件' })
  next.focus()
  fireEvent.keyDown(next, { key: 'Tab', shiftKey: true })
  expect(screen.getByText('识别详情与读取范围')).toHaveFocus()
  fireEvent.keyDown(drawer, { key: 'Escape' })

  expect(screen.queryByRole('dialog', { name: '文件详情' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('locks background scrolling while the narrow inspector drawer is open and restores it on close', () => {
  setWidth(390)
  const previousOverflow = document.body.style.overflow
  render(<Workbench state={makeState()} />)
  fireEvent.click(screen.getByRole('row', { name: /a\.md/ }))

  expect(document.body.style.overflow).toBe('hidden')
  fireEvent.click(screen.getByRole('button', { name: '关闭文件详情' }))
  expect(document.body.style.overflow).toBe(previousOverflow)
})

it('keeps next-file keyboard focus when the inspector remounts for another file', async () => {
  setWidth(390)
  function Harness() {
    const [activeId, setActiveId] = useState<string | null>('a')
    return <Workbench state={makeState({ activeId, setActiveId })} />
  }
  render(<Harness />)
  const trigger = screen.getByRole('row', { name: /a\.md/ })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '下一个文件' }))

  await waitFor(() => expect(screen.getByRole('button', { name: '下一个文件' })).toHaveFocus())
  expect(within(screen.getByRole('dialog', { name: '文件详情' })).getByText('b.md')).toBeInTheDocument()
})

it('keeps focus in file navigation when advancing disables the next button', async () => {
  setWidth(390)
  function Harness() {
    const [activeId, setActiveId] = useState<string | null>('a')
    return <Workbench state={makeState({ activeId, setActiveId })} />
  }
  render(<Harness />)
  const trigger = screen.getByRole('row', { name: /a\.md/ })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '下一个文件' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '下一个文件' })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: '下一个文件' }))

  await waitFor(() => expect(screen.getByRole('button', { name: '下一个文件' })).toBeDisabled())
  expect(screen.getByRole('button', { name: '上一个文件' })).toHaveFocus()
})

it('defaults new analysis to cloud only when offline-first is explicitly disabled and keeps consent unchecked', () => {
  const currentState = makeState()
  render(<Workbench state={currentState} offlineFirst={false} />)
  fireEvent.click(screen.getByRole('button', { name: /下一步：分析/ }))
  fireEvent.click(screen.getByRole('button', { name: /分析选中文件/ }))

  const consentDialog = screen.getByRole('dialog', { name: '分析 1 个所选文件' })
  expect(within(consentDialog).getByRole('radio', { name: /云端模型/ })).toBeChecked()
  expect(within(consentDialog).getByRole('checkbox')).not.toBeChecked()
  expect(within(consentDialog).getByRole('button', { name: '开始分析' })).toBeDisabled()
  fireEvent.click(within(consentDialog).getByRole('checkbox'))
  fireEvent.click(within(consentDialog).getByRole('button', { name: '开始分析' }))
  expect(currentState.analyze).toHaveBeenCalledWith('cloud', true, ['a'], expect.objectContaining({ endpoint: 'https://model.example/v1', config_version: 4 }))
})

it('keeps new analysis local when offline-first is omitted', () => {
  render(<Workbench state={makeState()} />)
  fireEvent.click(screen.getByRole('button', { name: /下一步：分析/ }))
  fireEvent.click(screen.getByRole('button', { name: /分析选中文件/ }))

  const consentDialog = screen.getByRole('dialog', { name: '分析 1 个所选文件' })
  expect(within(consentDialog).getByRole('radio', { name: /离线智能分类/ })).toBeChecked()
  expect(within(consentDialog).queryByRole('checkbox')).not.toBeInTheDocument()
})

it('keeps analysis local when offline-first is disabled but no model is configured', () => {
  const config = { ...configuredConfig, model: { ...configuredConfig.model, configured: false } }
  render(<Workbench state={makeState({ config })} offlineFirst={false} />)
  fireEvent.click(screen.getByRole('button', { name: /下一步：分析/ }))
  fireEvent.click(screen.getByRole('button', { name: /分析选中文件/ }))

  const consentDialog = screen.getByRole('dialog', { name: '分析 1 个所选文件' })
  expect(within(consentDialog).getByRole('radio', { name: /离线智能分类/ })).toBeChecked()
  expect(within(consentDialog).getByRole('radio', { name: /云端模型/ })).toBeDisabled()
})

it('offers only resume and cancel instead of analysis actions while a job is tracked as running', () => {
  const currentState = makeState({
    errors: { a: 'READ_FAILED' },
    job: { id: 'job', status: 'running', processed: 0, total: 1, mode: 'local', results: [], errors: [] },
  })
  render(<Workbench state={currentState} />)
  fireEvent.click(screen.getByRole('button', { name: /下一步：分析/ }))

  expect(screen.getByRole('button', { name: /分析选中文件/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: '仅重试失败项' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '继续查询进度' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '取消任务' })).toBeEnabled()
})

it.each([
  ['preparing', '准备中'],
  ['classifying', '分类中'],
])('shows a Chinese label for the %s analysis phase', (phase, label) => {
  const currentState = makeState({
    busy: 'analysis',
    job: { id: 'job', status: 'running', processed: 0, total: 1, current_file: 'a.md', phase, mode: 'local', results: [], errors: [] },
  })
  render(<Workbench state={currentState} />)

  expect(screen.getByRole('status')).toHaveTextContent(label)
})

it('keeps the detail shell mounted and moves navigation focus without scrolling the page', async () => {
  setWidth(1440)
  vi.mocked(api).mockResolvedValue({ text: 'Stable preview', sample: 'text' })
  function Harness() {
    const [activeId, setActiveId] = useState('a')
    return <Workbench state={makeState({ activeId, setActiveId })} />
  }
  render(<Harness />)
  fireEvent.click(screen.getByRole('row', { name: /a\.md/ }))
  await screen.findByText('Stable preview')
  const shell = screen.getByLabelText('文件详情')
  shell.scrollTop = 75
  const next = screen.getByRole('button', { name: '下一个文件' })
  const focus = vi.spyOn(next, 'focus')
  fireEvent.click(next)
  expect(screen.getByLabelText('文件详情')).toBe(shell)
  expect(shell.scrollTop).toBe(75)
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  await screen.findByText('Stable preview')
})

it('opens the fixed mobile detail drawer without scrolling the background into view', () => {
  setWidth(390)
  render(<Workbench state={makeState()} />)
  const original = Element.prototype.scrollIntoView
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  fireEvent.click(screen.getByRole('row', { name: /a\.md/ }))
  expect(screen.getByRole('dialog', { name: '文件详情' })).toBeInTheDocument()
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '关闭文件详情' })).toHaveFocus()
  Element.prototype.scrollIntoView = original
})

it('makes selected pending review the main action and keeps bulk edits inside collapsed more actions', () => {
  const current = makeState({ suggestions: { a: reviewSuggestion, b: { ...reviewSuggestion, file_id: 'b' } }, selected: new Set(['a', 'c']) })
  render(<Workbench state={current} />)
  fireEvent.click(within(screen.getByRole('navigation', { name: '整理步骤' })).getByRole('button', { name: /复核/ }))
  expect(screen.getByText(/确认已选文件的当前分类与名称.*筛选外已选项和待复核候选/)).toBeInTheDocument()
  expect(screen.getByText(/1 项尚未分析或存在未处理错误/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '一键审核已选项（1）' }))
  expect(current.approveSelected).toHaveBeenCalledOnce()
  expect(screen.getByRole('combobox', { name: '批量分类' })).not.toBeVisible()
  expect(screen.getByRole('button', { name: /重新分析所选/ })).not.toBeVisible()
  fireEvent.click(screen.getByText('更多操作'))
  expect(screen.getByRole('combobox', { name: '批量分类' })).toBeVisible()
  expect(screen.getByRole('button', { name: /重新分析所选/ })).toBeVisible()
})

it('disables approval once all eligible selected files are confirmed', () => {
  render(<Workbench state={makeState({ suggestions: { a: reviewSuggestion }, reviewed: new Set(['a']) })} />)
  fireEvent.click(within(screen.getByRole('navigation', { name: '整理步骤' })).getByRole('button', { name: /复核/ }))
  expect(screen.getByRole('button', { name: '一键审核已选项（0）' })).toBeDisabled()
  expect(screen.getByText(/已确认 1 项 · 剩余待确认 0 项/)).toBeInTheDocument()
})

it('closes a desktop drawer on page navigation and results without reopening it when returning', () => {
  const current = makeState()
  const { rerender } = render(<Workbench state={current} active />)
  fireEvent.click(screen.getByRole('row', { name: /a\.md/ }))
  expect(screen.getByRole('dialog', { name: '文件详情' })).toBeInTheDocument()
  rerender(<Workbench state={current} active={false} />)
  expect(screen.queryByRole('dialog', { name: '文件详情' })).not.toBeInTheDocument()
  expect(document.body.style.overflow).not.toBe('hidden')
  rerender(<Workbench state={current} active />)
  expect(screen.queryByRole('dialog', { name: '文件详情' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('row', { name: /a\.md/ }))
  fireEvent.click(within(screen.getByRole('navigation', { name: '整理步骤', hidden: true })).getByRole('button', { name: /计划与复制/, hidden: true }))
  expect(screen.queryByRole('dialog', { name: '文件详情' })).not.toBeInTheDocument()
})

it('closes with the backdrop, inerts the background and retains the same cached inspector on reopening', async () => {
  vi.mocked(api).mockResolvedValue({ text: 'Cached preview', sample: 'text' })
  const { container } = render(<Workbench state={makeState()} />)
  const trigger = screen.getByRole('row', { name: /a\.md/ })
  trigger.focus()
  fireEvent.click(trigger)
  await screen.findByText('Cached preview')
  const inspector = screen.getByRole('dialog', { name: '文件详情' })
  expect(container).toHaveAttribute('inert')
  fireEvent.click(screen.getByRole('button', { name: '关闭详情遮罩' }))
  expect(trigger).toHaveFocus()
  expect(container).not.toHaveAttribute('inert')
  fireEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: '文件详情' })).toBe(inspector)
  expect(screen.getByText('Cached preview')).toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(1)
})

it('offers a library entry after execution completes', () => {
  const onLibrary = vi.fn()
  const execution = { plan_id: 'p', status: 'completed', processed: 1, total: 1, current_file: null, items: [], error: null }
  render(<Workbench state={makeState({ execution })} onLibrary={onLibrary} />)
  fireEvent.click(within(screen.getByRole('navigation', { name: '整理步骤' })).getByRole('button', { name: /计划与复制/ }))
  fireEvent.click(screen.getByRole('button', { name: '查看资料库' }))
  expect(onLibrary).toHaveBeenCalledOnce()
})
