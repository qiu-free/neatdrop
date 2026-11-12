import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, it, expect, vi } from 'vitest'
import { PersonalRulesPanel } from './PersonalRulesPanel'
import { api } from '../api'

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn() }))

const listing = { available: true, revision: 2, rules: [] }
const match = { token: 'preview-token', revision: 2, rule: {}, matched: [{ file_id: 'f', name: 'report.md', keywords: ['quarterly', 'revenue'] }], evaluated: 4, excluded: 1, total: 5 }
const props = { workspaceId: 'workspace', jobId: 'finished-job', categories: { finance: '财务' }, subcategories: { finance: { report: '报告' } }, onClose: vi.fn(), onSettings: vi.fn(), onHelp: vi.fn() }

beforeEach(() => { vi.mocked(api).mockReset(); vi.mocked(api).mockResolvedValue(listing as never) })

const savedRule = { id: 'a'.repeat(32), name: '旧规则', keywords: ['quarterly', 'revenue'], extensions: ['.md'], category: 'finance', subcategory: 'report', enabled: false, created: '' }

it('keeps a trailing newline so a second keyword can be typed normally', async () => {
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\n' } })
  expect(screen.getByLabelText('匹配关键词')).toHaveValue('quarterly\n')
})

it('previews and enables the existing disabled rule instead of creating a duplicate', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...listing, rules: [savedRule] } as never).mockResolvedValueOnce(match as never).mockResolvedValueOnce({} as never).mockResolvedValueOnce(listing as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('旧规则')
  fireEvent.click(screen.getByRole('button', { name: '重新预览并启用' }))
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  await screen.findByText('report.md')
  expect(vi.mocked(api).mock.calls[1][1]).toMatchObject({ rule_id: savedRule.id })
  fireEvent.click(screen.getByRole('checkbox', { name: /我同意将这些关键词/ }))
  fireEvent.click(screen.getByRole('button', { name: '启用并保存规则' }))
  await screen.findByText('规则已保存并启用，下次离线分析生效。')
  expect(vi.mocked(api).mock.calls[2][0]).toBe(`/workspaces/workspace/classification-rules/${savedRule.id}/enable`)
})

it('deletes a rule only after its inline confirmation is clicked', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...listing, rules: [savedRule] } as never).mockResolvedValueOnce({} as never).mockResolvedValueOnce(listing as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('旧规则')
  fireEvent.click(screen.getByRole('button', { name: '删除规则：旧规则' }))
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await screen.findByText('规则已删除。')
  expect(vi.mocked(api).mock.calls[1]).toEqual([`/workspaces/workspace/classification-rules/${savedRule.id}`, { revision: 2, confirmed: true }, undefined, 'DELETE'])
  expect(screen.queryByText('旧规则')).not.toBeInTheDocument()
})

it('sends only the completed job id and normalized rule conditions for a local preview', async () => {
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockResolvedValueOnce(match as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '财务报告' } })
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\nrevenue' } })
  fireEvent.change(screen.getByLabelText('文件扩展名'), { target: { value: '.md' } })
  fireEvent.change(screen.getByLabelText('目标主类'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('目标子类'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  await screen.findByText('report.md')
  expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toBe('/workspaces/workspace/classification-rules/preview')
  expect(vi.mocked(api).mock.calls.at(-1)?.[1]).toMatchObject({ job_id: 'finished-job', name: '财务报告', keywords: ['quarterly', 'revenue'], extensions: ['.md'], category: 'finance', subcategory: 'report' })
  expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain('正文')
})

it('clears preview and consent immediately when a draft condition changes', async () => {
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockResolvedValueOnce(match as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '财务报告' } })
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\nrevenue' } })
  fireEvent.change(screen.getByLabelText('文件扩展名'), { target: { value: '.md' } })
  fireEvent.change(screen.getByLabelText('目标主类'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('目标子类'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  await screen.findByText('report.md')
  fireEvent.click(screen.getByRole('checkbox', { name: /我同意将这些关键词/ }))
  expect(screen.getByRole('button', { name: '启用并保存规则' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '更新后的规则' } })
  expect(screen.queryByText('report.md')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '启用并保存规则' })).toBeDisabled()
})

it('ignores a preview response that arrives after the directory job changes', async () => {
  let resolvePreview!: (value: unknown) => void
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve }) as never)
  const view = render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '财务报告' } })
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\nrevenue' } })
  fireEvent.change(screen.getByLabelText('文件扩展名'), { target: { value: '.md' } })
  fireEvent.change(screen.getByLabelText('目标主类'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('目标子类'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  view.rerender(<PersonalRulesPanel {...props} jobId="new-job" />)
  await act(async () => resolvePreview(match))
  expect(screen.queryByText('report.md')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '启用并保存规则' })).toBeDisabled()
})

it('unlocks the form when a draft edit invalidates a pending preview response', async () => {
  let resolvePreview!: (value: unknown) => void
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockImplementationOnce(() => new Promise(resolve => { resolvePreview = resolve }) as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '财务报告' } })
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\nrevenue' } })
  fireEvent.change(screen.getByLabelText('文件扩展名'), { target: { value: '.md' } })
  fireEvent.change(screen.getByLabelText('目标主类'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('目标子类'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '更新规则' } })
  expect(screen.getByRole('button', { name: '预览本次离线分析' })).toBeEnabled()
  await act(async () => resolvePreview(match))
  expect(screen.queryByText('report.md')).not.toBeInTheDocument()
})

it('keeps the draft and offers an explicit recovery action when preview fails', async () => {
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockRejectedValueOnce(new Error('当前分析任务无法预览，请重新分析后再试。'))
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '草稿规则' } })
  fireEvent.change(screen.getByLabelText('匹配关键词'), { target: { value: 'quarterly\nrevenue' } })
  fireEvent.change(screen.getByLabelText('文件扩展名'), { target: { value: '.md' } })
  fireEvent.change(screen.getByLabelText('目标主类'), { target: { value: 'finance' } })
  fireEvent.change(screen.getByLabelText('目标子类'), { target: { value: 'report' } })
  fireEvent.click(screen.getByRole('button', { name: '预览本次离线分析' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('无法用于规则预览')
  expect(screen.getByLabelText('规则名称')).toHaveValue('草稿规则')
  expect(screen.getByRole('button', { name: '了解规则预览要求' })).toBeInTheDocument()
})

it('treats an unavailable rule listing as read-only and explains recovery', async () => {
  vi.mocked(api).mockResolvedValueOnce({ available: false, revision: null, rules: [] } as never)
  render(<PersonalRulesPanel {...props} />)
  expect(await screen.findByText(/规则状态暂时不可用/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '预览本次离线分析' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '启用并保存规则' })).toBeDisabled()
})

it('blocks saving without a matching preview, durable consent, and a hit', async () => {
  vi.mocked(api).mockResolvedValueOnce(listing as never).mockResolvedValueOnce({ ...match, matched: [] } as never)
  render(<PersonalRulesPanel {...props} />)
  await screen.findByText('当前目录规则')
  expect(screen.getByRole('button', { name: '启用并保存规则' })).toBeDisabled()
})
