export interface GraphForceSettings { center: number; repulsion: number; attraction: number; linkDistance: number }
export interface GraphVisualSettings {
  colorMode: 'neutral' | 'category'; showIsolates: boolean; showSuggested: boolean
  nodeScale: number; edgeOpacity: number; edgeWidth: number; showDirections: boolean
  layoutPreset: 'compact' | 'balanced' | 'spacious'; layout: GraphForceSettings
}

const presets: Record<GraphVisualSettings['layoutPreset'], GraphForceSettings> = {
  compact: { center: .025, repulsion: 1800, attraction: .08, linkDistance: 70 },
  balanced: { center: .018, repulsion: 2600, attraction: .07, linkDistance: 100 },
  spacious: { center: .012, repulsion: 3500, attraction: .06, linkDistance: 140 },
}
export function graphLayoutPreset(preset: GraphVisualSettings['layoutPreset']): GraphForceSettings { return { ...presets[preset] } }
export const defaultGraphVisualSettings: GraphVisualSettings = {
  colorMode: 'category', showIsolates: true, showSuggested: true, nodeScale: 1, edgeOpacity: .8,
  edgeWidth: 1.6, showDirections: false, layoutPreset: 'balanced', layout: graphLayoutPreset('balanced'),
}
function clamp(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}
export function normalizeGraphVisualSettings(value: Partial<GraphVisualSettings> = {}): GraphVisualSettings {
  const preset = value.layoutPreset && value.layoutPreset in presets ? value.layoutPreset : 'balanced'
  const base = graphLayoutPreset(preset), layout = value.layout
  return {
    colorMode: value.colorMode === 'neutral' ? 'neutral' : 'category',
    showIsolates: typeof value.showIsolates === 'boolean' ? value.showIsolates : true,
    showSuggested: typeof value.showSuggested === 'boolean' ? value.showSuggested : true,
    nodeScale: clamp(value.nodeScale, 1, .5, 2), edgeOpacity: clamp(value.edgeOpacity, .8, 0, 1),
    edgeWidth: clamp(value.edgeWidth, 1.6, .5, 4), showDirections: value.showDirections === true,
    layoutPreset: preset,
    layout: {
      center: clamp(layout?.center, base.center, 0, .2), repulsion: clamp(layout?.repulsion, base.repulsion, 100, 10000),
      attraction: clamp(layout?.attraction, base.attraction, 0, .5), linkDistance: clamp(layout?.linkDistance, base.linkDistance, 35, 240),
    },
  }
}
