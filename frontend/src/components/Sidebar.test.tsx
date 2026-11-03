import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

it('shows the persisted exercise badge and opens the practice from the sidebar', () => {
  const onTutorial = vi.fn()
  render(<Sidebar page="help" onPage={() => undefined} online onTutorial={onTutorial} exerciseCompleted />)
  expect(screen.getAllByText('已练习').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: /试做安全练习/ }))
  expect(onTutorial).toHaveBeenCalledOnce()
})
