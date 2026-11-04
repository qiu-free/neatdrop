import { fireEvent, render, screen } from '@testing-library/react'
import { PlanDialog } from './PlanDialog'
import { FileTable } from './FileTable'
import { ConsentDialog } from './ConsentDialog'
import type { Config, FileRecord, Suggestion, Plan } from '../types'

const file: FileRecord = { id: 'a', name: 'notes.md', extension: '.md', size: 100, modified: 1, supported: true, reason: '', sha256: 'abc' }
const suggestion: Suggestion = { file_id: 'a', name: '课程笔记.md', category: 'study', evidence: '课程笔记', review_required: true, provider: 'local_rules', sample: 'text' }
const plan: Plan = { id: 'p', digest: 'digest', mode: 'copy', created: '', items: [{ file_id: 'a', source: 'notes.md', target: '02_学习科研/课程笔记.md', stage: 'planned', size: 100, sha256: 'abc' }] }

it('keeps unknown saved classification values readable without crashing the file list', () => {
  render(<FileTable files={[file]} suggestions={{ a: { ...suggestion, category: 'removed-category', subcategory: 'old-child' } as unknown as Suggestion }} edits={{}} selected={new Set()}
    activeId="a" filter="all" query="" errors={{}} onSelect={() => undefined} onActive={() => undefined} />)
  expect(screen.getByText('notes.md')).toBeInTheDocument()
  expect(screen.getByText('分类待核对')).toBeInTheDocument()
})

it('prevents execution until explicit confirmation checkbox is checked', () => {
  render(<PlanDialog plan={plan} busy={false} onConfirm={() => undefined} onClose={() => undefined} />)
  expect(screen.getByRole('button', { name: '确认生成归档副本' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', { name: '确认生成归档副本' })).toBeEnabled()
})

it('requires a fresh confirmation checkbox when the plan changes', () => {
  const { rerender } = render(<PlanDialog plan={plan} busy={false} onConfirm={() => undefined} onClose={() => undefined} />)
  fireEvent.click(screen.getByRole('checkbox'))
  rerender(<PlanDialog plan={{ ...plan, id: 'new-plan' }} busy={false} onConfirm={() => undefined} onClose={() => undefined} />)
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByRole('button', { name: '确认生成归档副本' })).toBeDisabled()
})

it('lets a review-required row join the batch while keeping its review status', () => {
  const onSelect = vi.fn()
  render(<FileTable files={[file]} suggestions={{ a: suggestion }} edits={{}} selected={new Set()}
    activeId="a" filter="all" query="" errors={{}} onSelect={onSelect} onActive={() => undefined} />)
  expect(screen.getByRole('checkbox', { name: '选择 notes.md' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '选择 notes.md' })).toBeEnabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 notes.md' }))
  expect(onSelect).toHaveBeenCalledWith('a')
  expect(screen.getByText('待复核')).toBeInTheDocument()
})

it('allows a review-required row into the batch after individual approval', () => {
  const onSelect = vi.fn()
  render(<FileTable files={[file]} suggestions={{ a: suggestion }} edits={{}} selected={new Set()}
    activeId="a" filter="all" query="" errors={{}} reviewed={new Set(['a'])} onSelect={onSelect} onActive={() => undefined} />)
  const checkbox = screen.getByRole('checkbox', { name: '选择 notes.md' })
  expect(checkbox).toBeEnabled()
  fireEvent.click(checkbox)
  expect(onSelect).toHaveBeenCalledWith('a')
})

it('filter and search show only matching real rows', () => {
  render(<FileTable files={[file]} suggestions={{ a: suggestion }} edits={{}} selected={new Set()}
    activeId="a" filter="all" query="不存在的文件" errors={{}} onSelect={() => undefined} onActive={() => undefined} />)
  expect(screen.queryByText('notes.md')).not.toBeInTheDocument()
  expect(screen.getByText('没有匹配的文件')).toBeInTheDocument()
})

it('clicking a category cell opens that file without selecting its checkbox', () => {
  const onActive = vi.fn(), onSelect = vi.fn()
  render(<FileTable files={[file]} suggestions={{ a: suggestion }} edits={{}} selected={new Set()}
    activeId={null} filter="all" query="" errors={{}} onSelect={onSelect} onActive={onActive} />)
  fireEvent.click(screen.getByText('学习科研'))
  expect(onActive).toHaveBeenCalledWith('a')
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
})

it('checking a file changes the batch without opening its details', () => {
  const onActive = vi.fn(), onSelect = vi.fn()
  render(<FileTable files={[file]} suggestions={{}} edits={{}} selected={new Set()}
    activeId={null} filter="all" query="" errors={{}} onSelect={onSelect} onActive={onActive} />)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(onSelect).toHaveBeenCalledWith('a')
  expect(onActive).not.toHaveBeenCalled()
})

it('active detail row is explicitly labelled and keyboard accessible', () => {
  const onActive = vi.fn()
  render(<FileTable files={[file]} suggestions={{}} edits={{}} selected={new Set()}
    activeId="a" filter="all" query="" errors={{}} onSelect={() => undefined} onActive={onActive} />)
  expect(screen.getByText('正在查看')).toBeInTheDocument()
  const row = screen.getByRole('row', { name: /notes.md/ })
  expect(row).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(onActive).toHaveBeenCalledWith('a')
})

it('binds cloud consent to the endpoint and configuration version shown to the user', () => {
  const onStart = vi.fn()
  const config = {
    model: { configured: true, text_model: 'text', vision_model: 'vision', max_requests_per_batch: 10, endpoint: 'https://model.example/v1', config_version: 4 },
    categories: {}, undo_supported: true, execution_supported: true, demo_path: '',
  } as Config
  render(<ConsentDialog count={2} config={config} initialMode="cloud" onClose={() => undefined} onStart={onStart} />)
  expect(screen.getByText(/https:\/\/model\.example\/v1.*版本 4/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
  expect(onStart).toHaveBeenCalledWith('cloud', true, { endpoint: 'https://model.example/v1', config_version: 4 })
})
