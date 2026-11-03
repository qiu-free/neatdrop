import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, children, onClose, busy = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const old = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, a[href], [tabindex="0"]')
        if (!nodes?.length) { event.preventDefault(); return }
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; old?.focus() }
  }, [busy, onClose])
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={panel} tabIndex={-1}>
      <header className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={busy}><X size={19} /></button></header>
      {children}
    </div>
  </div>
}
