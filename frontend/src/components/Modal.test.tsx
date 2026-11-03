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
