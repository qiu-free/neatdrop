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

    expect(loadPreferences(storage)).toEqual({ version: 1, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: true, exerciseCompleted: false } })
    expect(loadPreferences(memoryStorage('{broken'))).toEqual({ version: 1, density: 'comfortable',
      offlineFirst: true, tutorial: { tourCompleted: false, exerciseCompleted: false } })
  })

  it('tolerates storage that throws while reading or writing', () => {
    const unavailable: PreferenceStorage = {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
    }

    expect(loadPreferences(unavailable).density).toBe('comfortable')
    expect(savePreferences({ version: 1, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: false, exerciseCompleted: true } }, unavailable)).toBe(false)
  })

  it('serializes only the versioned preference whitelist', () => {
    const storage = memoryStorage()
    const withUnexpectedFields = { version: 1, density: 'comfortable', offlineFirst: false,
      tutorial: { tourCompleted: false, exerciseCompleted: true }, path: 'C:\\private', apiKey: 'secret' }

    expect(savePreferences(withUnexpectedFields as never, storage)).toBe(true)
    expect(storage.value).toBe(JSON.stringify({ version: 1, density: 'comfortable', offlineFirst: false,
      tutorial: { tourCompleted: false, exerciseCompleted: true } }))
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
    savePreferences({ version: 1, density: 'compact', offlineFirst: true,
      tutorial: { tourCompleted: false, exerciseCompleted: false } }, storage)
    window.removeEventListener('neatdrop:preferences', listener)

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ density: 'compact' })
  })
})
