import { fireEvent, render, screen } from '@testing-library/react'
import { HelpPage } from '../components/HelpPage'
vi.mock('../runtimeCapabilities', async () => import('./capabilities'))

it('keeps browser instructions and practice available without product explanation or service requests', () => {
  const onPractice = vi.fn(), onReplayTour = vi.fn()
  const requests = vi.spyOn(globalThis, 'fetch')
  render(<HelpPage onPractice={onPractice} onReplayTour={onReplayTour} />)
  expect(screen.getByRole('heading', { name: '五个阶段，整理学习资料' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('五阶段网页体验'))
  expect(screen.getByText(/没有真实复制、磁盘撤回、云端调用或实时图片识别/)).toBeInTheDocument()
  expect(screen.queryByText(/副本创建在同一文件夹/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '开始安全练习' }))
  fireEvent.click(screen.getByRole('button', { name: /重新开始导览/ }))
  expect(onPractice).toHaveBeenCalledOnce()
  expect(onReplayTour).toHaveBeenCalledOnce()
  expect(requests).not.toHaveBeenCalled()
  requests.mockRestore()
})
