import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from './Modal'

it('traps keyboard focus and restores the opener after Escape closes the dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>打开对话框</button>{open ? <Modal title="确认草稿" onClose={() => setOpen(false)}><button>继续</button></Modal> : null}</>
  }
  render(<Harness />)
  const opener = screen.getByRole('button', { name: '打开对话框' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: '确认草稿' })
  expect(dialog).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(screen.getByRole('button', { name: '继续' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(opener).toHaveFocus()
})

it('cycles past disabled and hidden controls while including textareas', () => {
  render(<Modal title="可用控件" onClose={() => undefined}>
    <textarea aria-label="备注" />
    <select aria-label="锁定选项" disabled><option>锁定</option></select>
    <div hidden><input aria-label="隐藏输入" /></div>
  </Modal>)
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(screen.getByRole('textbox', { name: '备注' })).toHaveFocus()
})

it('keeps the current field focused across busy and callback changes', () => {
  const { rerender } = render(<Modal title="配置" onClose={() => undefined}><input aria-label="名称" /></Modal>)
  screen.getByRole('textbox', { name: '名称' }).focus()
  rerender(<Modal title="配置" busy onClose={() => undefined}><input aria-label="名称" /></Modal>)
  expect(screen.getByRole('textbox', { name: '名称' })).toHaveFocus()
})

it('isolates the background and restores its previous inert state after closing', () => {
  const { container, unmount } = render(<><button>背景操作</button><Modal title="隔离" onClose={() => undefined}><button>弹窗操作</button></Modal></>)
  expect(document.body).toContainElement(screen.getByRole('dialog'))
  expect(container).toHaveAttribute('inert')
  unmount()
  expect(container).not.toHaveAttribute('inert')
})

it('recovers focus if it escapes the dialog', () => {
  render(<><button>背景操作</button><Modal title="焦点隔离" onClose={() => undefined}><button>弹窗操作</button></Modal></>)
  screen.getByText('背景操作').focus()
  expect(screen.getByRole('dialog')).toHaveFocus()
})
