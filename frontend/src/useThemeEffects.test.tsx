import { act, fireEvent, render, screen } from '@testing-library/react'
import { useThemeEffects } from './useThemeEffects'

function Surface() { useThemeEffects(); return <section className="directory-panel"><button>扫描目录</button></section> }
afterEach(() => vi.unstubAllGlobals())
it('adds only paint coordinates, coalesces pointer events and clears effects on leave/unmount', () => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  let draw!: FrameRequestCallback
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { draw = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const view = render(<Surface />), button = screen.getByRole('button', { name: '扫描目录' }), panel = button.parentElement!
  const click = vi.fn(); button.addEventListener('click', click)
  const move = () => { const event = new Event('pointermove', { bubbles: true }); Object.assign(event, { pointerType: 'mouse', clientX: 30, clientY: 40 }); fireEvent(button, event) }
  move(); move()
  expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
  act(() => draw(0))
  expect(panel.style.getPropertyValue('--theme-pointer-x')).toBe('30px')
  expect(panel.style.getPropertyValue('--theme-pointer-y')).toBe('40px')
  fireEvent.click(button); expect(click).toHaveBeenCalledOnce()
  fireEvent(document, new Event('pointerleave'))
  expect(panel.style.getPropertyValue('--theme-pointer-x')).toBe('')
  view.unmount(); expect(media.removeEventListener).toHaveBeenCalled()
})
it('keeps reduced-motion or touch surfaces static and usable', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('requestAnimationFrame', vi.fn())
  render(<Surface />)
  const button = screen.getByRole('button', { name: '扫描目录' })
  const event = new Event('pointermove', { bubbles: true }); Object.assign(event, { pointerType: 'touch', clientX: 30, clientY: 40 }); fireEvent(button, event)
  expect(requestAnimationFrame).not.toHaveBeenCalled()
  expect(button.parentElement!.style.getPropertyValue('--theme-pointer-x')).toBe('')
})
