import { useEffect } from 'react'

/** Subtle pointer light on existing surfaces. No new elements or input handling. */
export function useThemeEffects() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const enabled = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    let surface: HTMLElement | null = null
    let frame = 0
    let x = 0, y = 0
    const selector = '.directory-panel, .file-grid-card, .help-topic, .help-practice-card, .settings-preferences'
    const clear = () => {
      cancelAnimationFrame(frame)
      frame = 0
      surface?.style.removeProperty('--theme-pointer-x')
      surface?.style.removeProperty('--theme-pointer-y')
      surface = null
    }
    const move = (event: PointerEvent) => {
      if (!enabled.matches || event.pointerType !== 'mouse') { clear(); return }
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null
      if (!target) { clear(); return }
      if (surface !== target) { clear(); surface = target }
      x = event.clientX; y = event.clientY
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!surface?.isConnected) { clear(); return }
        const rect = surface.getBoundingClientRect()
        surface.style.setProperty('--theme-pointer-x', `${Math.round(x - rect.left)}px`)
        surface.style.setProperty('--theme-pointer-y', `${Math.round(y - rect.top)}px`)
      })
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', clear)
    document.addEventListener('scroll', clear, { passive: true, capture: true })
    document.addEventListener('pointerdown', clear, { passive: true })
    window.addEventListener('blur', clear)
    enabled.addEventListener('change', clear)
    return () => {
      clear()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', clear)
      document.removeEventListener('scroll', clear, true)
      document.removeEventListener('pointerdown', clear)
      window.removeEventListener('blur', clear)
      enabled.removeEventListener('change', clear)
    }
  }, [])
}
