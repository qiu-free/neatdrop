import { act, fireEvent, render, screen } from '@testing-library/react'
import { useThemeEffects } from './useThemeEffects'

function Surface() {
  useThemeEffects()
  return <><details className="help-topic"><summary>整理说明</summary><p>原件始终保留</p></details><details><summary>普通内容</summary><p>其他内容</p></details></>
}
function mediaPreference(enabled = true) {
  const media = { matches: enabled, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  return media
}
function openDisclosure(details: HTMLDetailsElement) {
  details.open = true
  fireEvent(details, new Event('toggle'))
}
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
afterEach(() => {
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  else delete (Element.prototype as Partial<Element>).animate
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

it('animates only newly revealed explanation content without moving its summary or changing focus', () => {
  mediaPreference()
  const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => undefined) }))
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  const view = render(<Surface />)
  const summary = screen.getByText('整理说明')
  act(() => summary.focus())
  openDisclosure(summary.parentElement as HTMLDetailsElement)
  expect(animate).toHaveBeenCalledOnce()
  expect(animate.mock.instances[0]).toBe(screen.getByText('原件始终保留'))
  expect(summary).toHaveFocus()
  openDisclosure(screen.getByText('普通内容').parentElement as HTMLDetailsElement)
  expect(animate).toHaveBeenCalledOnce()
  view.unmount()
  delete (Element.prototype as Partial<Element>).animate
})

it('cancels interrupted disclosures and cleans up motion on unmount', () => {
  const media = mediaPreference()
  const cancel = vi.fn()
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel, finished: new Promise<void>(() => undefined) })) })
  const view = render(<Surface />)
  const details = screen.getByText('整理说明').parentElement as HTMLDetailsElement
  openDisclosure(details)
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(cancel).toHaveBeenCalledOnce()
  openDisclosure(details)
  view.unmount()
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  delete (Element.prototype as Partial<Element>).animate
})

it('leaves content usable when reduced motion is enabled or the animation API is absent', () => {
  const media = mediaPreference(false)
  const animate = vi.fn()
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate })
  const view = render(<Surface />)
  const details = screen.getByText('整理说明').parentElement as HTMLDetailsElement
  openDisclosure(details)
  expect(animate).not.toHaveBeenCalled()
  expect(details.open).toBe(true)
  media.matches = true
  delete (Element.prototype as Partial<Element>).animate
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(true)
  view.unmount()
})

it('stops active disclosure motion when the user switches to reduced motion', () => {
  const media = mediaPreference()
  const cancel = vi.fn()
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel, finished: new Promise<void>(() => undefined) })) })
  const view = render(<Surface />)
  openDisclosure(screen.getByText('整理说明').parentElement as HTMLDetailsElement)
  const listener = media.addEventListener.mock.calls.find(([event]) => event === 'change')?.[1]
  expect(listener).toBeTypeOf('function')
  act(() => { media.matches = false; listener() })
  expect(cancel).toHaveBeenCalledOnce()
  view.unmount()
  delete (Element.prototype as Partial<Element>).animate
})
