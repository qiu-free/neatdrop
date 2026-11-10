import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Workbench } from '../components/Workbench'
import { createPageSession } from '../pageSession'
import { useWorkspace } from '../useWorkspace'
import { experienceEngine } from './engine'
import { readTextFiles } from './imports'
vi.mock('../api', async () => import('./experienceApi'))
vi.mock('../runtimeCapabilities', async () => import('./capabilities'))
vi.mock('./imports', () => ({ readTextFiles: vi.fn() }))
afterEach(() => { experienceEngine.reset(); vi.restoreAllMocks() })

it.each(['import', 'low-information'])('returns to selection after replacing results via %s', async mode => {
  const session = createPageSession().workbench; session.stage = 'results'
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.mocked(readTextFiles).mockResolvedValue([{ id: 'new-text', name: 'new.txt', text: '实际正文' }])
  function Harness() {
    const state = useWorkspace()
    return <><Workbench state={state} session={session} /><button onClick={() => void state.scan('网页体验 / 学习资料')}>fixture load</button></>
  }
  const view = render(<Harness />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'fixture load' })) })
  await waitFor(() => expect(screen.getByRole('heading', { name: '整理结果会显示在这里' })).toBeInTheDocument())
  if (mode === 'import') await act(async () => { fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['正文'], 'new.txt')] } }) })
  else await act(async () => { fireEvent.click(screen.getByText('载入低信息文本')) })
  await waitFor(() => expect(session.stage).toBe('choose'))
  expect(screen.getByRole('heading', { name: /选择需要整理的文件/ })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: `选择 ${mode === 'import' ? 'new.txt' : '短笔记.txt'}` })).toBeEnabled()
})
