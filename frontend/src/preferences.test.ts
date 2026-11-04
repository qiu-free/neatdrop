import { describe, expect, it } from 'vitest'
import { loadPreferences, savePreferences, type PreferenceStorage } from './preferences'

function memoryStorage(initial: string | null = null): PreferenceStorage & { value: string | null } {
  return {
    value: initial,
    getItem() { return this.value },
    setItem(_key, value) { this.value = value },
  }
}

describe('learning preferences', () => {
  it('loads only supported values and defaults malformed or unknown data', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: true, exerciseCompleted: false }, secret: 'must-not-survive' }))

    expect(loadPreferences(storage)).toEqual({ version: 2, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: false, tourStatus: 'legacy-dismissed', exerciseCompleted: false } })
    expect(loadPreferences(memoryStorage('{broken'))).toEqual({ version: 2, density: 'comfortable',
      offlineFirst: true, tutorial: { tourCompleted: false, tourStatus: 'unseen', exerciseCompleted: false } })
  })

  it('tolerates storage that throws while reading or writing', () => {
    const unavailable: PreferenceStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }

    expect(loadPreferences(unavailable).density).toBe('comfortable')
    expect(savePreferences({ version: 2, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: false, tourStatus: 'skipped', exerciseCompleted: true } }, unavailable)).toBe(false)
  })

  it('serializes only the versioned preference whitelist', () => {
    const storage = memoryStorage()
    const withUnexpectedFields = { version: 2, density: 'comfortable', offlineFirst: false,
      tutorial: { tourCompleted: false, tourStatus: 'skipped', exerciseCompleted: true }, path: 'C:\\private', apiKey: 'secret' }

    expect(savePreferences(withUnexpectedFields as never, storage)).toBe(true)
    expect(storage.value).toBe(JSON.stringify({ version: 2, density: 'comfortable', offlineFirst: false,
      tutorial: { tourCompleted: false, tourStatus: 'skipped', exerciseCompleted: true } }))
  })

  it('keeps an explicitly saved offline-first choice', () => {
    const storage = memoryStorage(JSON.stringify({ version: 1, density: 'comfortable', offlineFirst: false,
      tutorial: { tourCompleted: false, exerciseCompleted: false } }))
    expect(loadPreferences(storage).offlineFirst).toBe(false)
  })

  it('notifies the app when versioned preferences are saved', () => {
    const storage = memoryStorage()
    const listener = vi.fn()
    window.addEventListener('neatdrop:preferences', listener)
    savePreferences({ version: 2, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: false, tourStatus: 'unseen', exerciseCompleted: false } }, storage)
    window.removeEventListener('neatdrop:preferences', listener)

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ density: 'compact' })
  })

  it('retains skipped and completed as distinct statuses and ignores unknown future versions', () => {
    for (const status of ['skipped', 'completed'] as const) {
      const storage = memoryStorage(JSON.stringify({ version: 2, density: 'comfortable', offlineFirst: true,
        tutorial: { tourStatus: status, tourCompleted: true, exerciseCompleted: false } }))
      expect(loadPreferences(storage).tutorial).toEqual({ tourStatus: status, tourCompleted: status === 'completed', exerciseCompleted: false })
    }
    expect(loadPreferences(memoryStorage(JSON.stringify({ version: 99 }))).tutorial.tourStatus).toBe('unseen')
  })
})
