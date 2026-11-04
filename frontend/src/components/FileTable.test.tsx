import { fireEvent, render, screen } from '@testing-library/react'
import { FileTable } from './FileTable'

it('selects a batch item without opening its details and opens details with the file button', () => {
  const onSelect = vi.fn(), onActive = vi.fn()
  render(<FileTable files={[{ id: 'a', name: '课程.md', size: 10, modified: 1, extension: '.md', supported: true, reason: '', sha256: 'a' }]}
    suggestions={{}} edits={{}} selected={new Set()} activeId={null} filter="all" query="" errors={{}} onSelect={onSelect} onActive={onActive} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 课程.md' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('a')
  expect(onActive).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /课程\.md/ }))
  expect(onActive).toHaveBeenCalledExactlyOnceWith('a')
})
