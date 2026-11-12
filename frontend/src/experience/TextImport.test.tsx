import { act, fireEvent, render } from '@testing-library/react'
import { TextImport } from './TextImport'
import { readTextFiles } from './imports'
import { experienceEngine } from './engine'
vi.mock('./imports', () => ({ readTextFiles: vi.fn() }))
vi.mock('./engine', () => ({ experienceEngine: { installFiles: vi.fn() } }))
afterEach(() => vi.resetAllMocks())

it('never installs a delayed read after unmount, even when the reader ignores cancellation', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(readTextFiles).mockImplementation(() => new Promise(resolve => { finish = resolve as typeof finish }))
  const onImported = vi.fn(async (_path: string, prepare?: () => Promise<void>) => { await prepare?.(); return true })
  const view = render(<TextImport onImported={onImported} disabled={false} hasWorkspace={false} />)
  fireEvent.change(view.container.querySelector('input')!, { target: { files: [new File(['正文'], 'a.txt')] } })
  view.unmount()
  await act(async () => { finish([{ id: 'late', name: 'a.txt', text: '正文' }]) })
  expect(experienceEngine.installFiles).not.toHaveBeenCalled()
})

it('does not read or install until the parent accepts the preparation under its action lock', () => {
  const onImported = vi.fn(async () => false)
  const view = render(<TextImport onImported={onImported} disabled={false} hasWorkspace={false} />)
  fireEvent.change(view.container.querySelector('input')!, { target: { files: [new File(['正文'], 'a.txt')] } })
  expect(readTextFiles).not.toHaveBeenCalled()
  expect(experienceEngine.installFiles).not.toHaveBeenCalled()
})
