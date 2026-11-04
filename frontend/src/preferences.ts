export type Density = 'comfortable' | 'compact'

export interface TutorialProgress {
  tourCompleted: boolean
  tourStatus: 'unseen' | 'skipped' | 'completed' | 'legacy-dismissed'
  exerciseCompleted: boolean
}

export interface Preferences {
  version: 2
  density: Density
  offlineFirst: boolean
  tutorial: TutorialProgress
}

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PREFERENCES_STORAGE_KEY = 'neatdrop.preferences.v1'
export const DEFAULT_PREFERENCES: Preferences = {
  version: 2,
  density: 'comfortable',
  offlineFirst: true,
  tutorial: { tourCompleted: false, tourStatus: 'unseen', exerciseCompleted: false },
}

function freshDefaults(): Preferences {
  return { ...DEFAULT_PREFERENCES, tutorial: { ...DEFAULT_PREFERENCES.tutorial } }
}

function browserStorage(): PreferenceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function normalizePreferences(value: unknown): Preferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const progress = input.tutorial && typeof input.tutorial === 'object'
    ? input.tutorial as Record<string, unknown>
    : {}
  // v1 used the same flag for skipping and finishing. Preserve dismissal without
  // claiming that the person completed a tour we cannot distinguish.
  const tourStatus = input.version === 1
    ? progress.tourCompleted === true ? 'legacy-dismissed' : 'unseen'
    : ['skipped', 'completed', 'legacy-dismissed'].includes(String(progress.tourStatus))
      ? progress.tourStatus as TutorialProgress['tourStatus'] : 'unseen'
  return {
    version: 2,
    density: input.density === 'compact' ? 'compact' : 'comfortable',
    offlineFirst: input.offlineFirst !== false,
    tutorial: {
      tourCompleted: tourStatus === 'completed',
      tourStatus,
      exerciseCompleted: progress.exerciseCompleted === true,
    },
  }
}

export function loadPreferences(storage?: PreferenceStorage): Preferences {
  try {
    const raw = (storage ?? browserStorage())?.getItem(PREFERENCES_STORAGE_KEY)
    if (!raw) return freshDefaults()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || ![1, 2].includes(Number((parsed as Record<string, unknown>).version))) {
      return freshDefaults()
    }
    return normalizePreferences(parsed)
  } catch {
    return freshDefaults()
  }
}

export function savePreferences(preferences: Preferences, storage?: PreferenceStorage): boolean {
  try {
    const target = storage ?? browserStorage()
    if (!target) return false
    const normalized = normalizePreferences(preferences)
    target.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalized))
    try {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('neatdrop:preferences', { detail: normalized }))
    } catch { /* Preferences already saved; event delivery is optional. */ }
    return true
  } catch {
    return false
  }
}
