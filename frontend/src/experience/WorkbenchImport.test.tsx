import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Workbench } from '../components/Workbench'
import { createPageSession } from '../pageSession'
import { useWorkspace } from '../useWorkspace'
import { experienceEngine } from './engine'
import { readTextFiles } from './imports'
vi.mock('../api', async () => import('./experienceApi'))
vi.mock('../runtimeCapabilities', async () => import('./capabilities'))
vi.mock('./imports', () => ({ readTextFiles: vi.fn() }))
afterEach(() => { experienceEngine.reset(); vi.restoreAllMocks() })

it('locks later browser steps until selection, analysis, review and confirmed archive succeed', async () => {
  function Harness() { return <Workbench state={useWorkspace()} onLibrary={vi.fn()} /> }
  render(<Harness />)
  await waitFor(() => expect(screen.getByRole('button', { name: '载入学习样例' })).toBeEnabled())
  const navigation = within(screen.getByRole('navigation', { name: '网页体验五阶段' }))
  for (const step of [/2\./, /3\./, /4\./, /5\./]) expect(navigation.getByRole('button', { name: step })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '载入学习样例' }))
  await screen.findByRole('button', { name: '选择可见项' })
  expect(navigation.getByRole('button', { name: /2\./ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '选择可见项' }))
  expect(navigation.getByRole('button', { name: /2\./ })).toBeEnabled()
  for (const step of [/3\./, /4\./, /5\./]) expect(navigation.getByRole('button', { name: step })).toBeDisabled()
  fireEvent.click(navigation.getByRole('button', { name: /2\./ }))
  expect(screen.getByRole('button', { name: '查看建议' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '分析选中文件' }))
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '查看建议' })).toBeEnabled())
  expect(navigation.getByRole('button', { name: /4\./ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '查看建议' }))
  expect(navigation.getByRole('button', { name: /4\./ })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '一键审核已选项（8）' }))
  expect(navigation.getByRole('button', { name: /4\./ })).toBeEnabled()
  expect(navigation.getByRole('button', { name: /5\./ })).toBeDisabled()
  fireEvent.click(navigation.getByRole('button', { name: /4\./ }))
  const plan = await screen.findByRole('dialog', { name: '确认这一次整理' })
  expect(within(plan).getByRole('button', { name: '确认加入体验资料库' })).toBeDisabled()
  fireEvent.click(within(plan).getByRole('checkbox'))
  fireEvent.click(within(plan).getByRole('button', { name: '确认加入体验资料库' }))
  await screen.findByRole('heading', { name: '整理已完成' })
  expect(navigation.getByRole('button', { name: /5\./ })).toBeEnabled()
})

it.each(['import', 'low-information'])('returns to selection after replacing results via %s', async mode => {
  const session = createPageSession().workbench
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.mocked(readTextFiles).mockResolvedValue([{ id: 'new-text', name: 'new.txt', text: '实际正文' }])
  function Harness() {
    const state = useWorkspace()
    return <><Workbench state={state} session={session} /><button onClick={() => void state.scan('网页体验 / 学习资料')}>fixture load</button></>
  }
  const view = render(<Harness />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fixture load' })) })
  fireEvent.click(screen.getByRole('button', { name: '选择可见项' }))
  fireEvent.click(screen.getByRole('button', { name: /下一步：分析/ }))
  fireEvent.click(screen.getByRole('button', { name: '分析选中文件' }))
  fireEvent.click(screen.getByRole('button', { name: '开始分析' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '查看建议' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '查看建议' }))
  fireEvent.click(screen.getByRole('button', { name: '一键审核已选项（8）' }))
  fireEvent.click(screen.getByRole('button', { name: '生成整理计划' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: /我已核对/ }))
  fireEvent.click(screen.getByRole('button', { name: '确认加入体验资料库' }))
  await screen.findByRole('heading', { name: '整理已完成' })
  if (mode === 'import') await act(async () => { fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['正文'], 'new.txt')] } }) })
  else await act(async () => { fireEvent.click(screen.getByText('载入低信息文本')) })
  await waitFor(() => expect(session.stage).toBe('choose'))
  expect(screen.getByRole('heading', { name: /选择需要整理的文件/ })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: `选择 ${mode === 'import' ? 'new.txt' : '短笔记.txt'}` })).toBeEnabled()
})
