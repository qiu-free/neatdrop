import { defaultGraphVisualSettings, graphLayoutPreset, normalizeGraphVisualSettings } from './graphSettings'

it('defaults to a neutral balanced overview and preserves independent visual edits', () => {
  expect(defaultGraphVisualSettings).toMatchObject({ colorMode: 'neutral', showIsolates: true, showSuggested: true, nodeScale: 1, edgeOpacity: .55, edgeWidth: 1, showDirections: false, layoutPreset: 'balanced' })
  const changed = normalizeGraphVisualSettings({ colorMode: 'category', showSuggested: false, layout: { ...graphLayoutPreset('balanced'), attraction: .17 } })
  expect(changed.colorMode).toBe('category')
  expect(changed.showSuggested).toBe(false)
  expect(changed.layout.attraction).toBe(.17)
  expect(changed.showIsolates).toBe(true)
})

it('clamps invalid magnitudes and produces distinct compact and spacious link distances', () => {
  const settings = normalizeGraphVisualSettings({ nodeScale: -2, edgeOpacity: 4, edgeWidth: Infinity, layout: { center: -4, repulsion: Infinity, attraction: -3, linkDistance: 1 } })
  expect(settings.nodeScale).toBeGreaterThan(0)
  expect(settings.edgeOpacity).toBe(1)
  expect(Number.isFinite(settings.edgeWidth)).toBe(true)
  expect(settings.layout.center).toBeGreaterThanOrEqual(0)
  expect(Number.isFinite(settings.layout.repulsion)).toBe(true)
  expect(settings.layout.attraction).toBeGreaterThanOrEqual(0)
  expect(settings.layout.linkDistance).toBeGreaterThan(1)
  expect(graphLayoutPreset('compact').linkDistance).toBeLessThan(graphLayoutPreset('balanced').linkDistance)
  expect(graphLayoutPreset('balanced').linkDistance).toBeLessThan(graphLayoutPreset('spacious').linkDistance)
})
