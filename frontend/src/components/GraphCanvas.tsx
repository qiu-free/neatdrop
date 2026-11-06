import { useEffect, useRef, useState } from 'react'
import type cytoscape from 'cytoscape'
import type { GraphEdge, GraphNode } from '../graphProjection'
import './graph.css'
export function GraphCanvas({ nodes, edges, onOpen, onRelation, view, viewport, onViewport, onExpand, expanded }: { nodes: GraphNode[]; edges: GraphEdge[]; onOpen: (entry: string, relation?: string) => void; onRelation?: (relation: string) => void; view: 'categories' | 'relations'; viewport: { zoom: number; pan: { x: number; y: number } } | null; onViewport: (value: { zoom: number; pan: { x: number; y: number } }) => void; onExpand: (group: string) => void; expanded: Record<string, number> }) {
  const host = useRef<HTMLDivElement>(null), graph = useRef<cytoscape.Core | null>(null), latest = useRef({ onOpen, onRelation, onViewport, onExpand, expanded })
  const positioned = useRef(false)
  const previousView = useRef(view)
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [hovered, setHovered] = useState<string | null>(null)
  latest.current = { onOpen, onRelation, onViewport, onExpand, expanded }
  useEffect(() => {
    let live = true, instance: cytoscape.Core | null = null, observer: ResizeObserver | null = null
    import('cytoscape').then(({ default: cytoscape }) => {
      if (!live || !host.current) return
      instance = cytoscape({ container: host.current, elements: [], minZoom: .65, maxZoom: 2.8, wheelSensitivity: .2, style: [
        { selector: 'node', style: { label: 'data(label)', color: '#e6eaf8', 'font-size': 11, 'font-family': 'system-ui, sans-serif', 'text-wrap': 'wrap', 'text-max-width': '130px', width: 'data(size)', height: 'data(size)', padding: 4, 'background-color': 'data(color)', 'border-color': '#ffffff55', 'border-width': 1, shape: 'ellipse', 'text-valign': 'center', 'text-halign': 'center', 'text-background-color': '#0d0d16', 'text-background-opacity': .72, 'text-background-padding': 3 } },
        { selector: 'node[type="category"]', style: { color: '#ffffff', 'font-size': 13, 'font-weight': 'bold', 'border-width': 2, 'border-color': 'data(color)', 'text-background-opacity': .95 } },
        { selector: 'node[type="subcategory"]', style: { color: '#f2f3fb', 'font-size': 10, 'border-width': 2, 'border-color': 'data(color)', opacity: .9 } },
        { selector: 'node[type="file"]', style: { 'font-size': 10, 'border-width': 1 } },
        { selector: 'node:selected, node.is-hovered, node[?focused]', style: { 'border-color': '#ffffff', 'border-width': 3, 'font-weight': 'bold', opacity: 1 } },
        { selector: 'node.is-dimmed, edge.is-dimmed', style: { opacity: .16 } },
        { selector: 'node.is-neighbor, edge.is-neighbor', style: { opacity: 1 } },
        { selector: 'edge', style: { width: 1, 'line-color': '#8991b055', 'target-arrow-shape': 'none', 'curve-style': 'straight', opacity: .68 } },
        { selector: 'edge[kind="category"]', style: { width: 1, 'line-color': 'data(color)', opacity: .42 } },
        { selector: 'edge[kind!="category"]', style: { width: 1.4, 'line-color': '#b5b6ca99', 'curve-style': 'bezier', 'line-style': 'solid', label: 'data(label)', 'font-size': 9, color: '#e7e7f0', 'text-background-color': '#0d0d16', 'text-background-opacity': .88, 'text-background-padding': 2 } },
        { selector: 'edge[status="suggested"]', style: { 'line-style': 'dashed', 'line-color': '#f4ca6099' } },
        { selector: 'edge[kind="related"], edge[kind="duplicate"], edge[kind="text_similar"], edge[kind="visual_similar"]', style: { 'target-arrow-shape': 'none' } },
      ] as cytoscape.StylesheetJson, layout: { name: 'preset' }, userZoomingEnabled: true, userPanningEnabled: true })
      graph.current = instance
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => instance?.resize()); observer.observe(host.current) }
      instance.on('tap', 'node', event => { const node = event.target, data = node.data(); if (data.entry) latest.current.onOpen(data.entry); else if (data.group) latest.current.onExpand(data.group) })
      instance.on('tap', 'edge', event => { const data = event.target.data(); if (data.relation) { latest.current.onOpen(data.source.replace(/^file:/, ''), data.relation); latest.current.onRelation?.(data.relation) } })
      instance.on('mouseover', 'node', event => { const target = event.target; setHovered(readNodeLabel(target)); highlightNeighborhood(instance!, target) })
      instance.on('mouseout', 'node', () => { setHovered(null); clearNeighborhood(instance!) })
      instance.on('select', 'node', event => { setHovered(readNodeLabel(event.target)); highlightNeighborhood(instance!, event.target) })
      instance.on('unselect', 'node', () => { setHovered(null); clearNeighborhood(instance!) })
      instance.on('pan zoom', () => { const current = graph.current; if (current) latest.current.onViewport({ zoom: current.zoom(), pan: current.pan() }) })
      setReady(true)
    }).catch(() => { if (live) setError('关系画布暂不可用，请使用下方文件与关系列表。') })
    return () => { live = false; observer?.disconnect(); instance?.destroy(); graph.current = null; positioned.current = false }
  }, [])
  useEffect(() => {
    const instance = graph.current
    if (!instance) return
    const old = new Map(instance.elements().map(element => [element.id(), element.data('kind')]))
    const next = new Set([...nodes.map(node => node.data.id), ...edges.map(edge => edge.data.id)])
    instance.batch(() => {
      instance!.elements().forEach(element => { if (!next.has(element.id())) element.remove() })
      for (const node of nodes) {
        const existing = instance!.getElementById(node.data.id)
        if (existing.length) { existing.data(node.data); if (old.has(node.data.id)) existing.position(node.position) }
        else instance!.add({ group: 'nodes', data: node.data, position: node.position })
      }
      for (const edge of edges) if (!instance!.getElementById(edge.data.id).length) instance!.add({ group: 'edges', data: edge.data })
    })
    const viewChanged = previousView.current !== view
    previousView.current = view
    if (viewport) { instance.zoom(viewport.zoom); instance.pan(viewport.pan) }
    else if (viewChanged) fitReadable(instance)
    if (!positioned.current && nodes.length) {
      positioned.current = true
      if (!viewport) fitReadable(instance)
    }
  }, [nodes, edges, view, viewport, ready])
  const zoom = (factor: number) => { const current = graph.current; if (current) current.zoom({ level: Math.max(1, current.zoom() * factor), renderedPosition: { x: current.width() / 2, y: current.height() / 2 } }) }
  return <section className="graph-canvas-wrap" aria-label="关系画布"><div className="graph-canvas-tools"><button className="button secondary" onClick={() => zoom(1.2)} aria-label="放大画布">+</button><button className="button secondary" onClick={() => zoom(.83)} aria-label="缩小画布">−</button><button className="button secondary" onClick={() => { const current = graph.current; if (current) { fitReadable(current); onViewport({ zoom: current.zoom(), pan: current.pan() }) } }}>适合画布</button><button className="button secondary" onClick={() => { const current = graph.current; if (current) { current.reset(); fitReadable(current); onViewport({ zoom: current.zoom(), pan: current.pan() }) } }}>重置视图</button></div><div ref={host} className="graph-canvas" role="img" aria-label="归档分类和资料关系图" />{hovered ? <p className="graph-hover-status" role="status" aria-label="当前聚焦文件">当前聚焦文件：{hovered}</p> : null}{error ? <p role="status">{error}</p> : !ready ? <p className="graph-canvas-loading" role="status">正在加载本机关系画布…</p> : null}</section>
}
function fitReadable(instance: cytoscape.Core) {
  instance.fit(undefined, 45)
  if (instance.zoom() < 1) instance.zoom(1)
}

function highlightNeighborhood(instance: cytoscape.Core, node: cytoscape.NodeSingular) {
  const all = instance.elements()
  try {
    all.removeClass('is-dimmed')
    node.addClass('is-hovered')
    node.neighborhood().addClass('is-neighbor')
    all.difference(node.union(node.neighborhood())).addClass('is-dimmed')
  } catch {
    // Older Cytoscape builds may not expose collection helpers in test doubles.
  }
}

function clearNeighborhood(instance: cytoscape.Core) {
  try { instance.elements().removeClass('is-dimmed is-neighbor is-hovered') } catch { /* test doubles */ }
}

function readNodeLabel(node: cytoscape.NodeSingular) {
  const value = node.data('label')
  return typeof value === 'string' ? value : typeof value?.label === 'string' ? value.label : null
}



