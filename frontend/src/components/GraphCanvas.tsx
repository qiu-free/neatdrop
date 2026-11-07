import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { type GraphEdge, type GraphNode } from '../graphProjection'
import { forceLayoutGraph } from '../graphForceLayout'
import { defaultGraphVisualSettings, type GraphVisualSettings } from '../graphSettings'
import type { GraphDimension, GraphPosition, GraphViewport } from '../graphTypes'
import { fitGraphCamera, moveGraphPoint, projectGraphPoint, seedGraphDepth, zoomGraphCamera, type GraphCamera, type GraphPoint3D } from '../graph3d'
import './graph.css'

type Props = {
  nodes: GraphNode[]; edges: GraphEdge[]; onOpen: (entry: string, relation?: string) => void; onRelation?: (relation: string) => void
  view: 'categories' | 'relations'; viewport: GraphViewport | null; onViewport: (value: GraphViewport) => void
  onExpand: (group: string) => void; expanded: Record<string, number>; positions?: Record<string, GraphPosition>; onPositions?: (positions: Record<string, GraphPosition>) => void
  visual?: GraphVisualSettings; dimension?: GraphDimension; layoutRevision?: number
}
type Drag = { pointer: number; startX: number; startY: number; node?: string; pan: boolean; moved: boolean; camera: GraphCamera; point?: GraphPoint3D }
const initialCamera: GraphCamera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: { yaw: 0, pitch: 0 } }
const normalizeCamera = (value: GraphViewport): GraphCamera => ({ ...value, rotation: value.rotation ?? { yaw: 0, pitch: 0 } })

export function GraphCanvas(props: Props) {
  const { nodes, edges, view, viewport } = props
  const dimension = props.dimension ?? '2d', visual = props.visual ?? defaultGraphVisualSettings
  const svg = useRef<SVGSVGElement>(null), latest = useRef(props), cache = useRef<Record<string, Record<string, GraphPoint3D>>>({ categories: {}, relations: {} })
  latest.current = props
  const [size, setSize] = useState({ width: 800, height: 500 }), sizeRef = useRef(size)
  const [points, setPoints] = useState<Record<string, GraphPoint3D>>({}), pointsRef = useRef(points)
  const [camera, setCamera] = useState<GraphCamera>(() => viewport ? normalizeCamera(viewport) : initialCamera), cameraRef = useRef(camera)
  const [hovered, setHovered] = useState<string | null>(null), [selected, setSelected] = useState<string | null | undefined>(undefined), [dragging, setDragging] = useState(false), [operating, setOperating] = useState(false)
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false), frame = useRef<number | null>(null), autoFit = useRef(!viewport), previousMode = useRef<string | null>(null)
  const previousRevision = useRef<number | null>(null), previousForce = useRef<string | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>()), pinch = useRef<{ distance: number; camera: GraphCamera } | null>(null)
  const finishGesture = useRef<(pointer?: number, cancelled?: boolean) => void>(() => {})
  const markerId = useId().replace(/:/g, ''), hintId = `${markerId}-hint`
  const structure = `${view}|${props.layoutRevision ?? 0}|${nodes.map(node => node.data.id).sort().join('|')}|${edges.map(edge => `${edge.data.source}:${edge.data.target}`).sort().join('|')}|${Object.values(visual.layout).join('|')}`
  const mode = `${view}|${dimension}`
  const externalFocus = nodes.find(node => node.data.focused)?.data.id

  const paint = () => { setCamera({ ...cameraRef.current }); setPoints({ ...pointsRef.current }) }
  const schedulePaint = () => { if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; paint() }) }
  const flushPaint = () => { if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null } paint() }
  const saveCamera = (next: GraphCamera) => { cameraRef.current = next; autoFit.current = false; setCamera(next); latest.current.onViewport(next) }
  const savePositions = () => {
    const currentView = latest.current.view
    cache.current[currentView] = Object.fromEntries([...Object.entries(cache.current[currentView]).filter(([id]) => !(id in pointsRef.current)), ...Object.entries(pointsRef.current)].slice(-400))
    latest.current.onPositions?.(pointsRef.current)
  }
  finishGesture.current = (pointer, cancelled = false) => {
    const current = drag.current
    if (!current || (pointer !== undefined && current.pointer !== pointer)) return
    drag.current = null; setDragging(false)
    if (cancelled) suppressClick.current = false
    if (current.moved) { flushPaint(); latest.current.onViewport(cameraRef.current); if (current.node) savePositions() }
    if (svg.current?.hasPointerCapture?.(current.pointer)) svg.current.releasePointerCapture(current.pointer)
  }

  useLayoutEffect(() => {
    finishGesture.current(undefined, true)
    const forceKey = Object.values((latest.current.visual ?? defaultGraphVisualSettings).layout).join('|')
    const revised = previousRevision.current !== null && (previousRevision.current !== (latest.current.layoutRevision ?? 0) || previousForce.current !== forceKey)
    if (revised) cache.current[view] = {}
    const saved = revised ? {} : { ...latest.current.positions, ...cache.current[view] }
    const laidOut = forceLayoutGraph(latest.current.nodes, latest.current.edges, saved, (latest.current.visual ?? defaultGraphVisualSettings).layout)
    const next = Object.fromEntries(laidOut.map(node => [node.data.id, { ...node.position, z: saved[node.data.id]?.z ?? seedGraphDepth(node.data.id) }]))
    cache.current[view] = Object.fromEntries([...Object.entries(cache.current[view]).filter(([id]) => !(id in next)), ...Object.entries(next)].slice(-400))
    pointsRef.current = next; setPoints(next); latest.current.onPositions?.(next)
    if (previousMode.current !== mode) {
      touches.current.clear(); pinch.current = null; suppressClick.current = false; setHovered(null); setSelected(undefined)
      autoFit.current = !latest.current.viewport
      const nextCamera = latest.current.viewport ? normalizeCamera(latest.current.viewport) : fitGraphCamera(Object.values(next).map(point => dimension === '2d' ? { ...point, z: 0 } : point), sizeRef.current)
      cameraRef.current = nextCamera; setCamera(nextCamera); latest.current.onViewport(nextCamera)
    }
    previousMode.current = mode; previousRevision.current = latest.current.layoutRevision ?? 0; previousForce.current = forceKey
    // Only structural changes run layout. Selection and evidence responses never move nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure])

  useLayoutEffect(() => {
    if (previousMode.current === mode) return
    finishGesture.current(undefined, true); touches.current.clear(); pinch.current = null; suppressClick.current = false
    setHovered(null); setSelected(undefined)
    const next = latest.current.viewport ? normalizeCamera(latest.current.viewport) : fitGraphCamera(Object.values(pointsRef.current).map(point => dimension === '2d' ? { ...point, z: 0 } : point), sizeRef.current)
    const flat = dimension === '2d' ? { ...next, rotation: { yaw: 0, pitch: 0 } } : next
    cameraRef.current = flat; setCamera(flat); autoFit.current = !latest.current.viewport; latest.current.onViewport(flat)
    previousMode.current = mode
  }, [mode, dimension])

  useEffect(() => {
    if (!viewport || drag.current) return
    const next = dimension === '2d' ? { ...normalizeCamera(viewport), rotation: { yaw: 0, pitch: 0 } } : normalizeCamera(viewport)
    cameraRef.current = next; setCamera(next)
  }, [viewport, view, dimension])

  useEffect(() => { setSelected(undefined); setHovered(null) }, [externalFocus])

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const resize = () => {
      const bounds = element.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const next = { width: bounds.width, height: bounds.height }
      sizeRef.current = next; setSize(next)
      if (autoFit.current) {
        const mode = latest.current.dimension ?? '2d'
        const fitted = fitGraphCamera(Object.values(pointsRef.current).map(point => mode === '2d' ? { ...point, z: 0 } : point), next, mode === '2d' ? { yaw: 0, pitch: 0 } : cameraRef.current.rotation)
        cameraRef.current = fitted; setCamera(fitted); latest.current.onViewport(fitted)
      }
    }
    resize()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    observer?.observe(element)
    // Unfocused ordinary wheel input belongs to page scrolling.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && document.activeElement !== element) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const next = zoomGraphCamera(cameraRef.current, Math.exp(-Math.max(-300, Math.min(300, event.deltaY)) * .004), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 })
      cameraRef.current = next; autoFit.current = false; setCamera(next); latest.current.onViewport(next)
    }
    const blur = () => { finishGesture.current(undefined, true); touches.current.clear(); pinch.current = null }
    const end = (event: globalThis.PointerEvent) => {
      touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null
      finishGesture.current(event.pointerId, event.type === 'pointercancel')
    }
    element.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', blur)
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
    return () => { observer?.disconnect(); element.removeEventListener('wheel', wheel); window.removeEventListener('blur', blur); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [])

  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' && !operating) return
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touches.current.size === 2) {
        finishGesture.current(undefined, true)
        const [a, b] = [...touches.current.values()]
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), camera: cameraRef.current }
        return
      }
    }
    if (event.button !== 0 || drag.current) return
    const target = event.target instanceof Element ? event.target.closest('[data-graph-node]')?.getAttribute('data-graph-node') : null
    suppressClick.current = false
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, node: event.shiftKey ? undefined : target ?? undefined, pan: dimension === '2d' || event.shiftKey, moved: false, camera: cameraRef.current, point: target ? pointsRef.current[target] : undefined }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()], rect = svg.current!.getBoundingClientRect()
        const center = { x: (a.x + b.x) / 2 - rect.left - rect.width / 2, y: (a.y + b.y) / 2 - rect.top - rect.height / 2 }
        saveCamera(zoomGraphCamera(pinch.current.camera, Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance), center))
        return
      }
    }
    const current = drag.current
    if (!current || event.pointerId !== current.pointer) return
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) { pointerEnd(event, true); return }
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY
    if (!current.moved && Math.hypot(dx, dy) < 5) return
    // Decide before changing coordinates: vertical touch input belongs to page scrolling.
    if (!operating && !current.moved && event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) { finishGesture.current(event.pointerId, true); return }
    current.moved = true; suppressClick.current = true; autoFit.current = false; setDragging(true)
    if (!svg.current?.hasPointerCapture?.(event.pointerId)) svg.current?.setPointerCapture?.(event.pointerId)
    if (current.node && current.point) {
      const moved = moveGraphPoint(dimension === '2d' ? { ...current.point, z: 0 } : current.point, dx, dy, dimension === '2d' ? { ...current.camera, rotation: { yaw: 0, pitch: 0 } } : current.camera)
      pointsRef.current = { ...pointsRef.current, [current.node]: dimension === '2d' ? { ...moved, z: current.point.z } : moved }
    }
    else if (current.pan) cameraRef.current = { ...current.camera, pan: { x: current.camera.pan.x + dx, y: current.camera.pan.y + dy } }
    else cameraRef.current = { ...current.camera, rotation: { yaw: (current.camera.rotation.yaw + dx * .007) % (2 * Math.PI), pitch: Math.max(-1.15, Math.min(1.15, current.camera.rotation.pitch - dy * .007)) } }
    schedulePaint()
  }
  const pointerEnd = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    touches.current.delete(event.pointerId); if (touches.current.size < 2) pinch.current = null
    finishGesture.current(event.pointerId, cancelled)
  }
  const activate = (action: () => void) => { if (suppressClick.current) { suppressClick.current = false; return } action() }
  const keyboardActivate = (event: KeyboardEvent, action: () => void) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; action() } }
  const canvasKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    const rotation = { ...cameraRef.current.rotation }, pan = { ...cameraRef.current.pan }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0, dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
      if (dimension === '2d' || event.shiftKey) { pan.x += dx * 30; pan.y += dy * 30 } else { rotation.yaw += dx * .12; rotation.pitch = Math.max(-1.15, Math.min(1.15, rotation.pitch - dy * .12)) }
      saveCamera({ ...cameraRef.current, rotation, pan })
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); saveCamera(zoomGraphCamera(cameraRef.current, 1.2)) }
    else if (event.key === '-') { event.preventDefault(); saveCamera(zoomGraphCamera(cameraRef.current, 1 / 1.2)) }
    else if (event.key === 'Home') { event.preventDefault(); fit(true) }
  }
  const fit = (reset = false) => { const next = fitGraphCamera(Object.values(pointsRef.current).map(point => dimension === '2d' ? { ...point, z: 0 } : point), sizeRef.current, reset || dimension === '2d' ? { yaw: 0, pitch: 0 } : cameraRef.current.rotation); saveCamera(next); autoFit.current = true }
  const projected = useMemo(() => new Map(nodes.filter(node => points[node.data.id]).map(node => [node.data.id, { node, ...projectGraphPoint(dimension === '2d' ? { ...points[node.data.id], z: 0 } : points[node.data.id], dimension === '2d' ? { ...camera, rotation: { yaw: 0, pitch: 0 } } : camera, size) }])), [nodes, points, camera, size, dimension])
  const edgeOffsets = useMemo(() => {
    const pairs = new Map<string, GraphEdge[]>()
    edges.forEach(edge => { const key = [edge.data.source, edge.data.target].sort().join('|'); const pair = pairs.get(key) ?? []; pair.push(edge); pairs.set(key, pair) })
    const offsets = new Map<string, number>()
    pairs.forEach(pair => pair.sort((a, b) => a.data.id.localeCompare(b.data.id)).forEach((edge, index) => {
      if (pair.length === 1) return
      const slot = index - (pair.length - 1) / 2
      // Keep odd middle lanes curved and at least 54 control pixels apart.
      offsets.set(edge.data.id, (slot + (pair.length % 2 ? .5 : 0)) * 54)
    }))
    return offsets
  }, [edges])
  const selectedId = selected === undefined ? nodes.find(node => node.data.focused)?.data.id : selected
  const focused = hovered ?? selectedId
  const neighbors = new Set(focused ? [focused, ...edges.filter(edge => edge.data.source === focused || edge.data.target === focused).flatMap(edge => [edge.data.source, edge.data.target])] : [])
  const statusNode = nodes.find(node => node.data.id === (hovered ?? selectedId))
  const statusNeighbors = statusNode ? new Set(edges.filter(edge => edge.data.source === statusNode.data.id || edge.data.target === statusNode.data.id).map(edge => edge.data.source === statusNode.data.id ? edge.data.target : edge.data.source).filter(id => id !== statusNode.data.id)).size : 0

  return <section className="graph-canvas-wrap" aria-label="关系画布">
    <div className="graph-canvas-tools"><button className="button secondary" onClick={() => saveCamera(zoomGraphCamera(cameraRef.current, 1.2))} aria-label="放大画布" title="放大画布">+</button><button className="button secondary" onClick={() => saveCamera(zoomGraphCamera(cameraRef.current, 1 / 1.2))} aria-label="缩小画布" title="缩小画布">−</button><button className="button secondary" onClick={() => fit()}>适合画布</button><button className="button secondary" onClick={() => fit(true)}>重置视图</button></div>
    <button className="button secondary graph-touch-toggle" aria-pressed={operating} onClick={() => { finishGesture.current(undefined, true); touches.current.clear(); pinch.current = null; setOperating(!operating) }}>{operating ? '退出操作' : '操作图谱'}</button>
    <svg ref={svg} className={`graph-canvas graph-spatial-canvas${dragging ? ' is-dragging' : ''}${operating ? ' is-operating' : ''}`} style={{ touchAction: operating ? 'none' : 'auto' }} viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label="归档分类和资料关系图" aria-describedby={hintId} tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerEnd(event)} onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)} onKeyDown={canvasKey} onClick={() => { if (!suppressClick.current) { setSelected(null); setHovered(null) } suppressClick.current = false }}>
      <defs><marker id={markerId} viewBox="0 0 10 10" refX="14" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
      <g className="graph-edges">{edges.map(({ data }) => {
        const source = projected.get(data.source), target = projected.get(data.target)
        if (!source || !target) return null
        const active = focused && (data.source === focused || data.target === focused), action = () => { if (data.relation) { props.onOpen(data.source.replace(/^file:/, ''), data.relation); props.onRelation?.(data.relation) } }
        const x1 = source.x, y1 = source.y, x2 = target.x, y2 = target.y
        const direction = data.source.localeCompare(data.target) <= 0 ? 1 : -1, distance = Math.max(1, Math.hypot(x2 - x1, y2 - y1))
        const offset = edgeOffsets.get(data.id) ?? Math.max(16, Math.min(44, distance * .12))
        const path = `M ${x1} ${y1} Q ${(x1 + x2) / 2 - (y2 - y1) / distance * offset * direction} ${(y1 + y2) / 2 + (x2 - x1) / distance * offset * direction} ${x2} ${y2}`
        return <g key={data.id} className={`graph-spatial-edge ${data.kind === 'category' ? 'is-category' : `is-${data.origin ?? 'archive'}`}${data.status === 'suggested' ? ' is-suggested' : ''}${active ? ' is-neighbor' : ''}`} opacity={(focused && !active ? .18 : 1) * visual.edgeOpacity}>
          <path d={path} style={{ strokeWidth: visual.edgeWidth, strokeDasharray: data.status === 'suggested' ? '5 5' : 'none' }} markerEnd={data.directed && (visual.showDirections || active) ? `url(#${markerId})` : undefined} />
          {data.relation ? <path className="graph-edge-hit" d={path} role="button" tabIndex={0} aria-label={`查看 ${data.label ?? '资料'} 关系依据`} onClick={event => { event.stopPropagation(); activate(action) }} onKeyDown={event => keyboardActivate(event, action)}><title>{data.label} · 点击查看依据</title></path> : <title>分类归属</title>}
        </g>
      })}</g>
      <g className="graph-nodes">{[...projected.values()].sort((a, b) => a.depth - b.depth).map(({ node: { data }, x, y, scale, depth }) => {
        const radius = (data.size ?? 7) / 2 * visual.nodeScale * (dimension === '3d' ? Math.max(.88, Math.min(1.28, scale / Math.max(.001, camera.zoom ** 1.2))) : 1), active = data.id === focused
        const color = visual.colorMode === 'category' ? data.color ?? '#727b75' : (data.degree ?? 0) >= 8 ? '#3b4a47' : (data.degree ?? 0) >= 2 ? '#73817d' : '#a6afab'
        const action = () => { setHovered(null); setSelected(data.id); if (data.entry) props.onOpen(data.entry); else if (data.group) props.onExpand(data.group) }
        return <g key={data.id} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`} className={`graph-spatial-node is-${data.type}${active ? ' is-focused' : ''}`} role="button" tabIndex={0} aria-label={data.entry ? `预览 ${data.label}` : `展开 ${data.label}`} aria-pressed={selectedId === data.id} data-graph-node={data.id} data-depth={depth.toFixed(2)} opacity={focused && !neighbors.has(data.id) ? .5 : 1} onClick={event => { event.stopPropagation(); activate(action) }} onKeyDown={event => keyboardActivate(event, action)} onMouseEnter={() => { if (!drag.current) setHovered(data.id) }} onMouseLeave={() => setHovered(null)} onFocus={() => { setHovered(data.id); setSelected(data.id) }} onBlur={() => setHovered(null)}>
          <circle className="graph-node-hit" r={Math.max(12, radius)} />
          <circle className="graph-node-halo" r={radius + 5} />
          <circle className="graph-node-dot" r={radius} fill={color} />
        </g>
      })}</g>
    </svg>
    {statusNode?.data.entry ? <p className="graph-hover-status" role="status" aria-label="当前聚焦文件">当前聚焦文件：{statusNode.data.label} · {statusNode.data.categoryLabel ?? statusNode.data.category ?? '未分类'} · {statusNeighbors} 个相邻文件</p> : null}
    <p className="graph-interaction-hint" id={hintId}><span className="graph-depth-badge">{dimension === '2d' ? '2D' : '3D'}</span>{dimension === '2d' ? '拖动空白平移 · 拖动节点移动 · 聚焦画布后滚轮缩放' : '拖动空白旋转 · 拖动节点移动 · Shift 拖动平移 · 聚焦画布后滚轮缩放'}<span className="graph-keyboard-hint">；方向键{dimension === '2d' ? '平移' : '旋转'}，Home 重置</span></p>
    {!nodes.length ? <p className="graph-canvas-loading">当前分组已收起或没有匹配文件，请打开图谱设置调整筛选。</p> : null}
  </section>
}
