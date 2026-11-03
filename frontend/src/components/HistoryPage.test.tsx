import { render, screen } from '@testing-library/react'
import { HistoryPage } from './HistoryPage'
import type { useWorkspace } from '../useWorkspace'

function state(verified: boolean) {
  return {
    workspace: { id: 'w', path: 'local-samples' }, busy: '', config: { undo_supported: true },
    history: [{ id: 'a'.repeat(32), created: '2026-11-03T00:00:00Z', status: 'completed', acknowledged: false,
      undo_verified: verified, legacy_read_only: !verified,
      items: [{ file_id: 'a', source: 'notes.md', target: '02_学习科研/copy.md', stage: 'completed' }] }],
    historyAction: () => undefined,
  } as unknown as ReturnType<typeof useWorkspace>
}

it('legacy or imported journal is read-only with no undo control', () => {
  render(<HistoryPage state={state(false)} />)
  expect(screen.queryByRole('button', { name: '撤回归档副本' })).not.toBeInTheDocument()
  expect(screen.getByText(/没有当前安装的可信归档凭据/)).toBeInTheDocument()
})

it('trusted newly created copy has an undo control', () => {
  render(<HistoryPage state={state(true)} />)
  expect(screen.getByRole('button', { name: '撤回归档副本' })).toBeEnabled()
})
