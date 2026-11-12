import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Modal({ title, children, onClose, busy = false, scrollContent = false, footer }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; scrollContent?: boolean; footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const latest = useRef({ busy, onClose })
  latest.current = { busy, onClose }
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const background = Array.from(document.body.children).filter(element => element !== layerRef.current)
      .map(element => ({ element, inert: element.hasAttribute('inert') }))
    background.forEach(({ element }) => element.setAttribute('inert', ''))
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const availableControls = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]') ?? []).filter(node => {
      if (node.tabIndex < 0 || node.matches(':disabled, input[type="hidden"]') || node.closest('[hidden], [inert]') || node.closest('details:not([open])') && node.tagName !== 'SUMMARY') return false
      for (let ancestor: HTMLElement | null = node; ancestor && ancestor !== panel.current; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor)
        if (style.display === 'none' || style.visibility === 'hidden') return false
      }
      return true
    })
    const key = (event: KeyboardEvent) => {
      if (layerRef.current?.hasAttribute('inert')) return
      if (event.key === 'Escape' && !latest.current.busy) {
        event.preventDefault()
        latest.current.onClose()
      }
      if (event.key === 'Tab') {
        const nodes = availableControls()
        if (!nodes.length) { event.preventDefault(); panel.current?.focus(); return }
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }
    }
    const recoverFocus = (event: FocusEvent) => {
      if (!layerRef.current?.hasAttribute('inert') && event.target instanceof Node && !panel.current?.contains(event.target)) panel.current?.focus()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', recoverFocus)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', recoverFocus)
      background.forEach(({ element, inert }) => { if (!inert) element.removeAttribute('inert') })
      document.body.style.overflow = previousOverflow
      if (old?.isConnected) old.focus({ preventScroll: true })
    }
  }, [])
  const layerNode = <div className="modal-layer" ref={layerRef}><div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className={`modal${footer ? ' modal-with-fixed-actions' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
      <header className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={busy}><X size={19} aria-hidden="true" /></button></header>
      {scrollContent ? <div className="modal-scroll-region">{children}</div> : children}
      {footer ? <footer className="modal-fixed-actions">{footer}</footer> : null}
    </div>
  </div></div>
  return createPortal(layerNode, document.body)
}
