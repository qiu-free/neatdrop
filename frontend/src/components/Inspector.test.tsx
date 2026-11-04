import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Inspector } from './Inspector'
import type { FileRecord, Suggestion } from '../types'
import { api, initSession } from '../api'
import { useWorkspace } from '../useWorkspace'

vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), api: vi.fn(), initSession: vi.fn() }))
const file: FileRecord = { id: 'a', name: 'first.md', extension: '.md', size: 100, modified: 1, supported: true, reason: '', sha256: 'abc' }

it('previews the actual copy directory and keeps image zoom scoped to the active identity', async () => {
  vi.mocked(api).mockResolvedValue({ image: 'data:image/png;base64,AAAA', sample: 'image' })
  const props = { workspaceId: 'w', workspacePath: 'C:/source', onEdit: () => undefined,
    edit: { file_id: 'a', name: '图表.png', category: 'study' as const, subcategory: 'paper' } }
  const { rerender } = render(<Inspector {...props} file={{ ...file, name: 'first.png', extension: '.png' }} />)
  expect(screen.getByLabelText('归档副本位置')).toHaveTextContent('C:/source/02_学习科研/论文文献/图表.png')
  await screen.findByRole('img')
  fireEvent.click(screen.getByRole('button', { name: '放大预览' }))
  expect(screen.getByLabelText('预览缩放')).toHaveTextContent('125%')
  rerender(<Inspector {...props} file={{ ...file, id: 'b', name: 'second.png', extension: '.png', sha256: 'other' }} />)
  await screen.findByRole('img', { name: 'second.png 的本地缩略预览' })
  expect(screen.getByLabelText('预览缩放')).toHaveTextContent('适应窗口')
})

beforeEach(() => { vi.mocked(api).mockReset() })

it('shows reading limitations before technical evidence and does not auto approve', async () => {
  vi.mocked(api).mockResolvedValue({ text: 'Quality preview', sample: 'text' })
  const onApprove = vi.fn()
  render(<Inspector workspaceId="w" file={file} suggestion={{ file_id: 'a', name: 'first.md', category: 'study', subcategory: 'notes',
    evidence: '课程笔记', review_required: true, provider: 'local_rules', sample: 'text', quality: {
      state: 'limited', issues: ['text_garbled'], summary: '存在不可读文字，请人工核对。', metrics: { text_chars: 100 },
    } }} onEdit={() => undefined} onApprove={onApprove} />)
  expect(screen.getByRole('region', { name: '内容读取质量' })).toHaveTextContent('存在不可读文字，请人工核对。')
  expect(screen.getByRole('button', { name: '逐项确认此项' })).toBeEnabled()
  expect(onApprove).not.toHaveBeenCalled()
  await screen.findByText('Quality preview')
})

it('describes a chart type separately from the archive purpose with one clear review task', async () => {
  vi.mocked(api).mockResolvedValue({ image: 'data:image/png;base64,AAAA', sample: 'image' })
  render(<Inspector workspaceId="w" file={{ ...file, name: 'chart.png', extension: '.png' }} suggestion={{
    file_id: 'a', name: 'chart.png', category: 'study', subcategory: 'data_chart', content_form: 'data_chart',
    tags: ['pie_chart'], evidence: 'Logs', review_required: true, decision_level: 'candidate', provider: 'offline_models', sample: 'image',
    review_reasons: ['visual_type_uncalibrated', 'visual_purpose_uncalibrated'],
  }} onEdit={() => undefined} />)
  expect(screen.getByLabelText('识别到的内容')).toHaveTextContent('可能为饼图')
  expect(screen.getByLabelText('本项核对任务')).toHaveTextContent('核对内容与归档位置，再确认此项')
  expect(screen.getByLabelText('归档副本位置')).toHaveTextContent('02_学习科研/数据图表/chart.png')
  await screen.findByRole('img')
})

it('old preview response cannot appear under a different active file', async () => {
  let resolveFirst!: (data: unknown) => void
  let resolveSecond!: (data: unknown) => void
  vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))
  const { rerender } = render(<Inspector workspaceId="w" file={file} onEdit={() => undefined} />)
  rerender(<Inspector workspaceId="w" file={{ ...file, id: 'b', name: 'second.md' }} onEdit={() => undefined} />)
  await act(async () => { resolveSecond({ text: 'SECOND FILE CONTENT', sample: 'text' }) })
  await act(async () => { resolveFirst({ text: 'FIRST FILE CONTENT', sample: 'text' }) })
  expect(screen.getByText('SECOND FILE CONTENT')).toBeInTheDocument()
  expect(screen.queryByText('FIRST FILE CONTENT')).not.toBeInTheDocument()
  expect(screen.getByText('second.md')).toBeInTheDocument()
})

it('rescan of changed bytes under same file id refreshes preview', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'OLD CONTENT', sample: 'text' })
    .mockResolvedValueOnce({ text: 'UPDATED CONTENT', sample: 'text' })
  const { rerender } = render(<Inspector workspaceId="w" file={file} onEdit={() => undefined} />)
  await screen.findByText('OLD CONTENT')
  rerender(<Inspector workspaceId="w" file={{ ...file, sha256: 'newhash' }} onEdit={() => undefined} />)
  await screen.findByText('UPDATED CONTENT')
  expect(screen.queryByText('OLD CONTENT')).not.toBeInTheDocument()
})

it('reuses a visited preview in memory without showing another files content while loading', async () => {
  let resolveSecond!: (data: unknown) => void
  vi.mocked(api).mockResolvedValueOnce({ text: 'CACHED FIRST', sample: 'text' })
    .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))
  const props = { workspaceId: 'w', onEdit: () => undefined }
  const second = { ...file, id: 'b', name: 'second.md', sha256: 'second-hash' }
  const { rerender } = render(<Inspector {...props} file={file} />)
  await screen.findByText('CACHED FIRST')
  const stage = screen.getByLabelText('内容预览')
  rerender(<Inspector {...props} file={second} />)
  expect(screen.queryByText('CACHED FIRST')).not.toBeInTheDocument()
  expect(screen.getByLabelText('内容预览')).toBe(stage)
  await act(async () => { resolveSecond({ text: 'SECOND CONTENT', sample: 'text' }) })
  rerender(<Inspector {...props} file={file} />)
  expect(screen.getByText('CACHED FIRST')).toBeInTheDocument()
  expect(vi.mocked(api)).toHaveBeenCalledTimes(2)
})

it('replaces the image surface between identities so a decoded old bitmap cannot remain under the new name', async () => {
  vi.mocked(api).mockResolvedValueOnce({ image: 'data:image/png;base64,AAAA', sample: 'image' })
    .mockResolvedValueOnce({ image: 'data:image/png;base64,BBBB', sample: 'image' })
  const props = { workspaceId: 'w', onEdit: () => undefined }
  const { rerender } = render(<Inspector {...props} file={{ ...file, name: 'first.png', extension: '.png' }} />)
  const first = await screen.findByRole('img', { name: 'first.png 的本地缩略预览' })
  rerender(<Inspector {...props} file={{ ...file, id: 'b', name: 'second.png', extension: '.png', sha256: 'new' }} />)
  const second = await screen.findByRole('img', { name: 'second.png 的本地缩略预览' })
  expect(second).not.toBe(first)
  rerender(<Inspector {...props} file={{ ...file, name: 'first.png', extension: '.png' }} />)
  const cachedFirst = screen.getByRole('img', { name: 'first.png 的本地缩略预览' })
  expect(cachedFirst).not.toBe(second)
})

it('lets a user individually approve a review-required suggestion', async () => {
  const onApprove = vi.fn()
  const suggestion: Suggestion = { file_id: 'a', name: 'first.md', category: 'other', evidence: '线索不足', review_required: true, provider: 'local_rules', sample: '' }
  vi.mocked(api).mockResolvedValueOnce({ text: 'Approval preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={suggestion} onEdit={() => undefined} onApprove={onApprove} />)
  fireEvent.click(screen.getByRole('button', { name: '逐项确认此项' }))
  expect(onApprove).toHaveBeenCalledOnce()
  await screen.findByText('Approval preview')
})

it('requires analysis or a manual edit before an item can be confirmed', async () => {
  const onApprove = vi.fn()
  vi.mocked(api).mockResolvedValueOnce({ text: 'Manual preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} onEdit={() => undefined} onApprove={onApprove} />)
  const confirm = screen.getByRole('button', { name: '先分析或编辑后确认' })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(onApprove).not.toHaveBeenCalled()
  await screen.findByText('Manual preview')
})

it('does not approve an edited file with an unresolved analysis error', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Failed preview', sample: 'text' })
  const onApprove = vi.fn()
  render(<Inspector workspaceId="w" file={file} edit={{ file_id: 'a', name: '人工.md', category: 'study' }} analysisError="READ_FAILED" onEdit={() => undefined} onApprove={onApprove} />)
  expect(screen.getByRole('button', { name: '处理错误后确认' })).toBeDisabled()
  expect(screen.getByText(/分析错误尚未处理/)).toBeInTheDocument()
  await screen.findByText('Failed preview')
})

const candidateSuggestion: Suggestion = {
  file_id: 'a', name: '研究资料.md', category: 'study', subcategory: 'paper',
  evidence: '存在摘要与参考文献结构。', review_required: true, provider: 'local_rules', sample: 'text',
  decision_level: 'candidate',
  candidates: [
    { category: 'study', subcategory: 'paper', score: .98, evidence: '有研究方法和引用结构。' },
    { category: 'study', subcategory: 'notes', score: .84, evidence: '也包含定义和例题。' },
  ],
  engine_versions: { rules: '3', semantic: 'test-v1' },
}

it('choosing a candidate edits classification, preserves the current name and leaves approval explicit', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Candidate preview', sample: 'text' })
  const onEdit = vi.fn()
  const onApprove = vi.fn()
  render(<Inspector workspaceId="w" file={file} suggestion={candidateSuggestion}
    edit={{ file_id: 'a', name: '人工名称.md', category: 'study', subcategory: 'paper' }}
    onEdit={onEdit} onApprove={onApprove} />)

  fireEvent.click(screen.getByRole('button', { name: '选择候选：学习科研 / 课程笔记' }))

  expect(onEdit).toHaveBeenCalledExactlyOnceWith({ file_id: 'a', name: '人工名称.md', category: 'study', subcategory: 'notes' })
  expect(onApprove).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '逐项确认此项' })).toBeEnabled()
  expect(screen.getByText(/选择候选会更新分类，仍需逐项确认/)).toBeInTheDocument()
  await screen.findByText('Candidate preview')
})

it('disables candidate edits and approval while analysis is running', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Busy preview', sample: 'text' })
  const onEdit = vi.fn()
  const onApprove = vi.fn()
  render(<Inspector workspaceId="w" file={file} suggestion={candidateSuggestion} onEdit={onEdit}
    onApprove={onApprove} editingDisabled />)

  const button = screen.getByRole('button', { name: '选择候选：学习科研 / 课程笔记' })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(onEdit).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '逐项确认此项' })).toBeDisabled()
  expect(onApprove).not.toHaveBeenCalled()
  await screen.findByText('Busy preview')
})

it('shows at most three valid unique taxonomy candidates without converting scores to percentages', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Taxonomy preview', sample: 'text' })
  const candidates = [
    { category: 'unknown-category', subcategory: null, evidence: 'INVALID CATEGORY' },
    { category: 'study', subcategory: 'invoice', evidence: 'INVALID SUBCATEGORY' },
    { category: '__proto__', subcategory: null },
    { category: 'study', subcategory: 'paper', score: .98 },
    { category: 'study', subcategory: 'paper', score: .97 },
    { category: 'study', subcategory: 'notes', score: .84 },
    { category: 'office', subcategory: 'report', score: .75 },
    { category: 'activity', subcategory: 'meeting', score: .65 },
  ] as Suggestion['candidates']
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion, candidates }} onEdit={() => undefined} />)

  const choices = screen.getByRole('group', { name: '其他可能的归档用途' })
  expect(within(choices).getAllByRole('button')).toHaveLength(3)
  expect(within(choices).getByRole('button', { name: '选择候选：工作办公 / 报告' })).toBeInTheDocument()
  expect(within(choices).queryByRole('button', { name: /会议资料/ })).not.toBeInTheDocument()
  expect(choices).not.toHaveTextContent(/unknown-category|INVALID|__proto__|98%|0\.98|84%/)
  await screen.findByText('Taxonomy preview')
})

it('keeps a main-only suggestion and candidate nullable until the user chooses a subcategory', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Main category preview', sample: 'text' })
  const onEdit = vi.fn()
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion,
    subcategory: null, candidates: [{ category: 'office', subcategory: null, evidence: '用途仍需确认。' }],
  }} onEdit={onEdit} />)

  expect(screen.getByLabelText('二级分类')).toHaveValue('')
  expect(screen.getByText(/二级分类待确认/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '选择候选：工作办公 / 仅按主分类归档' }))
  expect(onEdit).toHaveBeenCalledExactlyOnceWith({ file_id: 'a', name: '研究资料.md', category: 'office', subcategory: null })
  await screen.findByText('Main category preview')
})

it.each([
  ['ordinary', '普通建议'], ['candidate', '待复核候选'], ['abstain', '暂不判断用途'],
] as const)('shows the %s decision without claiming an accuracy score', async (decision_level, label) => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Decision preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion, decision_level }} onEdit={() => undefined} />)
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: '文件详情' })).not.toHaveTextContent(/\d+%/)
  await screen.findByText('Decision preview')
})

it.each([
  { truncated: true, budget_exhausted: false },
  { truncated: false, budget_exhausted: true },
])('explains sampled coverage and preserves a mandatory review warning: %j', async flags => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Sampling preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion,
    sampling: { kind: 'pdf', ...flags, segments: [{ page: 1 }, { page: 2 }, { page: 8 }, { page: 16 }], summary: '第 1、2、8、16 页的本地抽样。' },
    evidence_items: [{ source: 'structure', text: '包含摘要与研究方法。', page: 8 }],
  }} onEdit={() => undefined} />)

  fireEvent.click(screen.getByText('识别详情与读取范围'))
  const coverage = screen.getByRole('region', { name: '读取范围' })
  expect(coverage).toHaveTextContent('第 1、2、8、16 页的本地抽样。')
  expect(coverage).toHaveTextContent(/未完整读取.*确认归档用途/)
  expect(screen.getByText('结构')).toBeInTheDocument()
  expect(screen.getByText('第 8 页')).toBeInTheDocument()
  await screen.findByText('Sampling preview')
})

it('does not warn about partial coverage for a complete local sample', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Complete preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion,
    sampling: { kind: 'text', truncated: false, budget_exhausted: false, segments: [{ start: 0, end: 200 }], summary: '已读取全部 200 字符。' },
  }} onEdit={() => undefined} />)
  fireEvent.click(screen.getByText('识别详情与读取范围'))
  const coverage = screen.getByRole('region', { name: '读取范围' })
  expect(coverage).toHaveTextContent('已读取全部 200 字符。')
  expect(coverage).not.toHaveTextContent('未完整读取')
  await screen.findByText('Complete preview')
})

it('explains offline semantic evidence and decision reasons in Chinese', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Semantic preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion, provider: 'offline_semantic',
    review_reasons: ['subtype_ambiguous', 'engine_disagreement', 'partial_content', 'semantic_partial', 'engine_incomplete', 'unsafe_title'],
    evidence_items: [{ source: 'semantic', text: '正文与论文用途定义相符。' }],
  }} onEdit={() => undefined} />)

  expect(screen.getByText('本地语义依据')).toBeInTheDocument()
  expect(screen.getByText('语义')).toBeInTheDocument()
  expect(screen.getByText(/二级分类候选接近；各引擎的用途线索不一致；文件未完整读取；语义分析仅覆盖部分内容；部分识别能力未完成；标题不宜自动用于命名/)).toBeInTheDocument()
  await screen.findByText('Semantic preview')
})

it('describes text and image evidence locations without exposing engine score metrics', async () => {
  vi.mocked(api).mockResolvedValueOnce({ text: 'Locations preview', sample: 'text' })
  render(<Inspector workspaceId="w" file={file} suggestion={{ ...candidateSuggestion,
    evidence_items: [
      { source: 'structure', text: '正文中段。', location: { start: 300, end: 600 } },
      { source: 'ocr', text: '边缘标题。', box: [[0, 0], [200, 0], [200, 60], [0, 60]] },
    ],
  }} onEdit={() => undefined} />)
  expect(screen.getByText('字符 301–600')).toBeInTheDocument()
  expect(screen.getByText('图像局部区域')).toBeInTheDocument()
  await screen.findByText('Locations preview')
})

function CandidateWorkspace() {
  const workspace = useWorkspace()
  const active = workspace.workspace?.files[0]
  return <>
    <button onClick={() => void workspace.scan('C:/test')} disabled={!workspace.online}>扫描测试目录</button>
    <button onClick={() => workspace.toggle('a')}>选择测试项</button>
    <button onClick={() => void workspace.analyze('local', false)}>分析测试项</button>
    <button onClick={() => void workspace.createPlan()}>生成测试计划</button>
    <output aria-label="确认状态">{workspace.reviewed.has('a') ? '已确认' : '待确认'}</output>
    <output aria-label="计划状态">{workspace.plan ? '已有计划' : '没有计划'}</output>
    <output aria-label="流程错误">{workspace.error}</output>
    {active ? <Inspector workspaceId={workspace.workspace!.id} file={active} suggestion={workspace.suggestions.a}
      edit={workspace.edits.a} onEdit={workspace.edit} reviewed={workspace.reviewed.has('a')}
      onApprove={() => workspace.approve('a')} editingDisabled={workspace.busy === 'analysis'} /> : null}
  </>
}

it('candidate selection through the real workspace hook clears previous approval and an existing plan', async () => {
  vi.mocked(initSession).mockResolvedValue(undefined)
  const config = {
    model: { configured: false, text_model: '', vision_model: '', max_requests_per_batch: 20 },
    categories: {}, undo_supported: true, execution_supported: true, demo_path: 'C:/test',
  }
  const job = { id: 'job', status: 'completed', processed: 1, total: 1, mode: 'local', results: [candidateSuggestion], errors: [] }
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve(config) as never
    if (path === '/workspaces') return Promise.resolve({ id: 'w', name: 'Test', path: 'C:/test', files: [file] }) as never
    if (path === '/workspaces/w/transactions') return Promise.resolve([]) as never
    if (path === '/workspaces/w/files/a/preview') return Promise.resolve({ text: 'Integrated preview', sample: 'text' }) as never
    if (path === '/analysis-jobs' || path === '/analysis-jobs/job') return Promise.resolve(job) as never
    if (path === '/workspaces/w/plans') return Promise.resolve({ id: 'plan', digest: 'digest', created: '', mode: 'copy', items: [] }) as never
    return Promise.reject(new Error(`Unexpected API request ${path}`))
  })
  render(<CandidateWorkspace />)
  await waitFor(() => expect(screen.getByRole('button', { name: '扫描测试目录' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '扫描测试目录' }))
  await screen.findByText('Integrated preview')
  fireEvent.click(screen.getByRole('button', { name: '选择测试项' }))
  fireEvent.click(screen.getByRole('button', { name: '分析测试项' }))
  await screen.findByRole('button', { name: '选择候选：学习科研 / 课程笔记' })
  fireEvent.click(screen.getByRole('button', { name: '逐项确认此项' }))
  fireEvent.click(screen.getByRole('button', { name: '生成测试计划' }))
  await waitFor(() => expect(screen.getByLabelText('计划状态')).toHaveTextContent('已有计划'))
  expect(screen.getByLabelText('确认状态')).toHaveTextContent('已确认')

  fireEvent.click(screen.getByRole('button', { name: '选择候选：学习科研 / 课程笔记' }))

  expect(screen.getByLabelText('确认状态')).toHaveTextContent('待确认')
  expect(screen.getByLabelText('计划状态')).toHaveTextContent('没有计划')
  expect(screen.getByLabelText('归档副本名称', { exact: false })).toHaveValue('研究资料.md')
  expect(screen.getByLabelText('二级分类')).toHaveValue('notes')
  fireEvent.click(screen.getByRole('button', { name: '生成测试计划' }))
  await waitFor(() => expect(screen.getByLabelText('流程错误')).toHaveTextContent(/未逐项确认/))
  expect(screen.getByLabelText('计划状态')).toHaveTextContent('没有计划')
})
