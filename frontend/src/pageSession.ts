import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Category, Filter, Page } from './types'

export type WorkbenchStage = 'choose' | 'analyze' | 'review' | 'results'
export interface WorkbenchSession {
  path: string; workspace: string | null; stage: WorkbenchStage; filter: Filter; query: string
  viewChoice: { workspace: string; view: 'grid' | 'list' } | null
  bulkCategory: Category; listScroll: number
}
export interface LibrarySession { workspace: string | null; category: string; query: string }
export interface HelpSession { query: string }
export function createPageSession() {
  return {
    workbench: { path: '', workspace: null, stage: 'choose', filter: 'all', query: '', viewChoice: null, bulkCategory: 'other', listScroll: 0 } as WorkbenchSession,
    library: { workspace: null, category: 'all', query: '' } as LibrarySession,
    help: { query: '' } as HelpSession,
    scroll: { workbench: 0, library: 0, history: 0, help: 0 } as Record<Page, number>,
  }
}

/** This object is owned by App's ref; it is never serialized to browser storage. */
export function useSessionState<S extends object, K extends keyof S>(session: S | undefined, key: K, initial: S[K]): [S[K], Dispatch<SetStateAction<S[K]>>] {
  const [value, setValue] = useState<S[K]>(() => session ? session[key] : initial)
  const latest = useRef(value)
  const update: Dispatch<SetStateAction<S[K]>> = useCallback(next => {
    const result = typeof next === 'function' ? (next as (value: S[K]) => S[K])(latest.current) : next
    latest.current = result
    if (session) session[key] = result
    setValue(result)
  }, [session, key])
  return [value, update]
}
