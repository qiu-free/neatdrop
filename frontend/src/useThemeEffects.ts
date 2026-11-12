import { useEffect } from 'react'

/** A short reveal for explicit disclosures. Never delays content or handles clicks. */
export function useThemeEffects() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const enabled = matchMedia('(prefers-reduced-motion: no-preference)')
    const active = new Map<HTMLDetailsElement, Animation[]>()
    const cancel = (details: HTMLDetailsElement) => {
      active.get(details)?.forEach(animation => animation.cancel())
      active.delete(details)
    }
    const clear = () => {
      active.forEach(animations => animations.forEach(animation => animation.cancel()))
      active.clear()
    }
    const reveal = (event: Event) => {
      const details = event.target
      if (!(details instanceof HTMLDetailsElement) || !details.matches('.help-topic, .sidebar-directory-path, .review-more, .recognition-details')) return
      cancel(details)
      if (!details.open || !enabled.matches || document.visibilityState === 'hidden') return
      const animations: Animation[] = []
      for (const child of details.children) {
        if (!(child instanceof HTMLElement) || child.tagName === 'SUMMARY' || typeof child.animate !== 'function') continue
        try {
          const animation = child.animate([
            { opacity: .4, transform: 'translateY(-4px)' },
            { opacity: 1, transform: 'none' },
          ], { duration: 180, easing: 'cubic-bezier(.16, 1, .3, 1)' })
          animations.push(animation)
          const settle = () => {
            if (active.get(details) !== animations) return
            const index = animations.indexOf(animation)
            if (index >= 0) animations.splice(index, 1)
            if (!animations.length) active.delete(details)
          }
          void animation.finished.then(settle, settle)
        } catch { /* Native disclosure remains open when animation is unavailable. */ }
      }
      if (animations.length) active.set(details, animations)
    }
    document.addEventListener('toggle', reveal, true)
    document.addEventListener('visibilitychange', clear)
    enabled.addEventListener('change', clear)
    return () => {
      clear()
      document.removeEventListener('toggle', reveal, true)
      document.removeEventListener('visibilitychange', clear)
      enabled.removeEventListener('change', clear)
    }
  }, [])
}
