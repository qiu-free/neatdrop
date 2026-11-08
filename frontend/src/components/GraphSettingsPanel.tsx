import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { graphKindLabels, type GraphDimension, type GraphKind } from '../graphTypes'
import { graphLayoutPreset, type GraphForceSettings, type GraphVisualSettings } from '../graphSettings'

type Props = {
  category: string; kind: GraphKind | 'all'; categories: Record<string, string>
  categoryIds: string[]; categoryColors: Record<string, string>; categoryCounts: Record<string, number>
  groups: { id: string; label: string; count: number; shown: number }[]
  expansion: Record<string, number>; visual: GraphVisualSettings; dimension: GraphDimension
  onCategory: (value: string) => void; onKind: (value: GraphKind | 'all') => void
  onCategoryToggle: (id: string) => void; onGroupMore: (id: string) => void; onGroupCollapse: (id: string) => void
  onVisual: (value: GraphVisualSettings) => void; onDimension: (value: GraphDimension) => void
  onRearrange: () => void; onReset: () => void; onClose: () => void
}

export function GraphSettingsPanel(props: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeButton.current?.focus({ preventScroll: true }) }, [])
  const { visual, onVisual } = props
  const setVisual = (change: Partial<GraphVisualSettings>) => onVisual({ ...visual, ...change })
  const setForce = (key: keyof GraphForceSettings, value: number) =>
    setVisual({ layout: { ...visual.layout, [key]: value } })
  return <aside className="graph-tools" role="region" aria-label="图谱设置面板" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); props.onClose() }
  }}>
    <header className="graph-tools-heading">
      <strong>图谱设置</strong>
      <button ref={closeButton} className="graph-icon-button" aria-label="关闭图谱设置" onClick={props.onClose}><X size={16} /></button>
    </header>
    <details open>
      <summary>筛选</summary>
      <div className="graph-settings-section">
        <label>主分类<select value={props.category} onChange={event => props.onCategory(event.target.value)}>
          <option value="all">全部分类</option>
          {props.categoryIds.map(id => <option key={id} value={id}>{props.categories[id] ?? id}</option>)}
        </select></label>
        <label>关系类型<select value={props.kind} onChange={event => props.onKind(event.target.value as GraphKind | 'all')}>
          <option value="all">全部关系</option>
          {Object.entries(graphKindLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label className="graph-check"><input type="checkbox" checked={visual.showIsolates} onChange={event => setVisual({ showIsolates: event.target.checked })} />显示孤立文件</label>
        <label className="graph-check"><input type="checkbox" checked={visual.showSuggested} onChange={event => setVisual({ showSuggested: event.target.checked })} />显示待核实候选</label>
      </div>
    </details>
    <details>
      <summary>颜色组</summary>
      <div className="graph-settings-section">
        <div className="graph-group-panel" aria-label="分类分组列表">
          {props.categoryIds.map(id => <div className="graph-group-row" key={id}>
            <span className="graph-group-dot" style={{ background: props.categoryColors[id] }} />
            <span className="graph-group-name">{props.categories[id] ?? id}</span>
            <span className="graph-group-count">{props.categoryCounts[id] ?? 0}</span>
            <button className="graph-icon-button" aria-label={`${props.expansion[id] === 0 ? '展开' : '收起'} ${props.categories[id] ?? id}`} onClick={() => props.onCategoryToggle(id)}>{props.expansion[id] === 0 ? '+' : '−'}</button>
          </div>)}
        </div>
        <div className="graph-subgroup-panel">{props.groups.map(group => <div className="graph-subgroup-row" key={group.id}>
          <span>{group.label} · {group.count} 项</span>
          <button className="button secondary" aria-label={`${group.shown ? '继续展开' : '展开'} ${group.label}`} disabled={group.shown >= group.count} onClick={() => props.onGroupMore(group.id)}>{group.shown >= group.count ? `已显示 ${group.count} 项` : group.shown ? '再显示 50 项' : '展开文件'}</button>
          {group.shown > 0 ? <button className="button secondary" aria-label={`收起 ${group.label}`} onClick={() => props.onGroupCollapse(group.id)}>收起</button> : null}
        </div>)}</div>
      </div>
    </details>
    <details>
      <summary>外观</summary>
      <div className="graph-settings-section">
        <fieldset className="graph-segment"><legend>空间维度</legend>
          {(['2d', '3d'] as const).map(value => <button key={value} type="button" aria-pressed={props.dimension === value} onClick={() => props.onDimension(value)}>{value.toUpperCase()}</button>)}
        </fieldset>
        <fieldset className="graph-radio"><legend>节点颜色</legend>
          <label><input type="radio" name="graph-color" aria-label="中性配色" checked={visual.colorMode === 'neutral'} onChange={() => setVisual({ colorMode: 'neutral' })} />中性</label>
          <label><input type="radio" name="graph-color" aria-label="分类配色" checked={visual.colorMode === 'category'} onChange={() => setVisual({ colorMode: 'category' })} />分类</label>
        </fieldset>
        <label>节点大小<input type="range" min="0.5" max="2" step="0.1" value={visual.nodeScale} onChange={event => setVisual({ nodeScale: Number(event.target.value) })} /></label>
        <label>连线透明度<input type="range" min="0" max="1" step="0.05" value={visual.edgeOpacity} onChange={event => setVisual({ edgeOpacity: Number(event.target.value) })} /></label>
        <label>连线宽度<input type="range" min="0.5" max="4" step="0.1" value={visual.edgeWidth} onChange={event => setVisual({ edgeWidth: Number(event.target.value) })} /></label>
        <label className="graph-check"><input type="checkbox" checked={visual.showDirections} onChange={event => setVisual({ showDirections: event.target.checked })} />显示方向箭头</label>
      </div>
    </details>
    <details>
      <summary>布局</summary>
      <div className="graph-settings-section">
        <label>布局密度<select value={visual.layoutPreset} onChange={event => {
          const layoutPreset = event.target.value as GraphVisualSettings['layoutPreset']
          setVisual({ layoutPreset, layout: graphLayoutPreset(layoutPreset) })
        }}><option value="compact">紧凑</option><option value="balanced">均衡</option><option value="spacious">宽松</option></select></label>
        <details className="graph-advanced"><summary>高级力度</summary>
          {([['center', '中心力', 0, .2, .001], ['repulsion', '排斥力', 100, 10000, 100], ['attraction', '吸引力', 0, .5, .005], ['linkDistance', '连线距离', 35, 240, 5]] as const).map(([key, label, min, max, step]) =>
            <label key={key}>{label}<input type="range" min={min} max={max} step={step} value={visual.layout[key]} onChange={event => setForce(key, Number(event.target.value))} /></label>)}
        </details>
        <div className="graph-settings-actions"><button className="button secondary" onClick={props.onRearrange}>重新排列</button><button className="button secondary" onClick={props.onReset}>重置布局</button></div>
      </div>
    </details>
  </aside>
}
