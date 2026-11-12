import { act, render, screen, waitFor } from '@testing-library/react'
import { GraphImageEvidence } from './GraphImageEvidence'
import { requestPreview } from '../previewRequests'
import type { LibraryItem } from '../types'
vi.mock('../previewRequests', () => ({ requestPreview: vi.fn() }))
const items: LibraryItem[] = ['one', 'two'].map(id => ({ id, name: `${id}.png`, category: 'photos', subcategory: null, transaction_id: 'tx', source: id, target: id, created: '', size: 1, availability: 'available' }))
beforeEach(() => vi.mocked(requestPreview).mockReset())

it('requests both verified archive endpoints and displays each trusted image with its filename', async () => {
  vi.mocked(requestPreview).mockResolvedValue({ image: 'data:image/png;base64,AAAA', sample: 'image' })
  render(<GraphImageEvidence workspaceId="ws" relationId="r1" source={items[0]} target={items[1]} />)
  expect(await screen.findByRole('img', { name: 'one.png 的关系依据图片' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'two.png 的关系依据图片' })).toBeInTheDocument()
  expect(vi.mocked(requestPreview).mock.calls.map(call => call[0])).toEqual(['/workspaces/ws/library/one/preview', '/workspaces/ws/library/two/preview'])
})

it('aborts stale relation previews and never renders a late image under the new relation', async () => {
  let finish!: (value: { image: string; sample: string }) => void
  vi.mocked(requestPreview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ image: 'https://unsafe/image.png', sample: 'image' })
  const view = render(<GraphImageEvidence workspaceId="ws" relationId="r1" source={items[0]} target={items[1]} />)
  const oldSignal = vi.mocked(requestPreview).mock.calls[0][1]!
  view.rerender(<GraphImageEvidence workspaceId="ws-new" relationId="r2" source={items[0]} target={items[1]} />)
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finish({ image: 'data:image/png;base64,OLD', sample: 'image' }))
  await waitFor(() => expect(screen.getAllByText('此副本没有可显示的安全图片预览。')).toHaveLength(2))
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  view.unmount()
})

it('shows independent unavailable and unsafe-image states without requesting an unavailable copy', async () => {
  vi.mocked(requestPreview).mockResolvedValue({ image: 'https://unsafe/image.png', sample: 'image' })
  const view = render(<GraphImageEvidence workspaceId="ws" relationId="r1" source={{ ...items[0], availability: 'missing' }} target={items[1]} />)
  expect(screen.getByText('副本已丢失，无法读取图片。')).toBeInTheDocument()
  expect(await screen.findByText('此副本没有可显示的安全图片预览。')).toBeInTheDocument()
  expect(requestPreview).toHaveBeenCalledTimes(1)
  view.unmount()
})
