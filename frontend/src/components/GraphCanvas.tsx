import { useEffect, useRef, useState } from 'react'
import type cytoscape from 'cytoscape'
import { layoutGraph, type GraphEdge, type GraphNode } from '../graphProjection'
import './graph.css'
export function GraphCanvas({ nodes, edges, onOpen, onRelation, view, viewport, onViewport, onExpand, expanded, positions, onPositions }: { nodes: GraphNode[]; edges: GraphEdge[]; onOpen: (entry: string, relation?: string) => void; onRelation?: (relation: string) => void; view: 'categories' | 'relations'; viewport: { zoom: number; pan: { x: number; y: number } } | null; onViewport: (value: { zoom: number; pan: { x: number; y: number } }) => void; onExpand: (group: string) => void; expanded: Record<string, number>; positions?: Record<string, { x: number; y: number }>; onPositions?: (positions: Record<string, { x: number; y: number }>) => void }) {
  const host = useRef<HTMLDivElement>(null), graph = useRef<cytoscape.Core | null>(null), latest = useRef({ onOpen, onRelation, onViewport, onExpand, expanded, onPositions, positions })
  const lastStructure = useRef('')
  const previousView = useRef(view)
  const [error, setError] = useState(''), [ready, setReady] = useState(false), [hovered, setHovered] = useState<string | null>(null)
  latest.current = { onOpen, onRelation, onViewport, onExpand, expanded, onPositions, positions }
  useEffect(() => {
    let live = true, instance: cytoscape.Core | null = null, observer: ResizeObserver | null = null
    import('cytoscape').then(({ default: cytoscape }) => {
      if (!live || !host.current) return
      instance = cytoscape({ container: host.current, elements: [], minZoom: .2, maxZoom: 2.8, wheelSensitivity: .2, style: [
        { selector: 'node', style: { label: 'data(label)', color: '#e6eaf8', 'font-size': 13, 'font-family': 'system-ui, sans-serif', 'text-wrap': 'wrap', 'text-max-width': '170px', width: 'data(size)', height: 'data(size)', padding: 4, 'background-color': 'data(color)', 'border-color': '#ffffff', 'border-opacity': .34, 'border-width': 1, shape: 'ellipse', 'text-valign': 'center', 'text-halign': 'center', 'text-background-color': '#0d0d16', 'text-background-opacity': .82, 'text-background-padding': 3 } },
        { selector: 'node[type="category"]', style: { color: '#ffffff', 'font-size': 16, 'font-weight': 'bold', 'border-width': 2, 'border-color': 'data(color)', 'text-valign': 'bottom', 'text-margin-y': 9, 'text-background-opacity': .95 } },
        { selector: 'node[type="subcategory"]', style: { color: '#f2f3fb', 'font-size': 14, 'border-width': 2, 'border-color': 'data(color)', 'text-valign': 'bottom', 'text-margin-y': 7, opacity: .9 } },
        { selector: 'node[type="file"]', style: { label: '', 'font-size': 14, 'border-width': 1, 'text-valign': 'bottom', 'text-margin-y': 6 } },
        { selector: 'node[type="file"].is-hovered, node[type="file"]:selected, node[type="file"][?focused]', style: { label: 'data(label)', 'z-index': 10 } },
        { selector: 'node:selected, node.is-hovered, node[?focused]', style: { 'border-color': '#ffffff', 'border-width': 3, 'font-weight': 'bold', opacity: 1 } },
        { selector: 'node.is-dimmed, edge.is-dimmed', style: { opacity: .16 } },
        { selector: 'node.is-neighbor, edge.is-neighbor', style: { opacity: 1 } },
        { selector: 'edge', style: { width: 1, 'line-color': '#8991b0', 'line-opacity': .36, 'target-arrow-shape': 'none', 'curve-style': 'straight', opacity: .68 } },
        { selector: 'edge[kind="category"]', style: { width: 1, 'line-color': 'data(color)', opacity: .5 } },
        { selector: 'edge[kind!="category"]', style: { width: 1.4, 'line-color': 'data(color)', 'curve-style': 'bezier', 'line-style': 'solid', label: '', 'font-size': 13, color: '#e7e7f0', 'text-background-color': '#0d0d16', 'text-background-opacity': .88, 'text-background-padding': 2 } },
        { selector: 'edge.is-hovered', style: { label: 'data(label)', width: 3, 'line-opacity': 1, 'z-index': 10 } },
        { selector: 'edge[origin="archive"]', style: { 'line-color': '#d6d7e0', 'line-opacity': .75, 'line-style': 'solid' } },
        { selector: 'edge[origin="manual"]', style: { 'line-color': '#78c4bb', 'line-style': 'solid', width: 2 } },
        { selector: 'edge[origin="automatic"]', style: { 'line-color': '#f4ca60', 'line-opacity': .85, 'line-style': 'dashed' } },
        { selector: 'edge[?directed]', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': '#78c4bb' } },
      ] as cytoscape.StylesheetJson, layout: { name: 'preset' }, userZoomingEnabled: true, userPanningEnabled: true })
      graph.current = instance
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => instance?.resize()); observer.observe(host.current) }
      instance.on('tap', 'node', event => { const node = event.target, data = node.data(); if (data.entry) latest.current.onOpen(data.entry); else if (data.group) latest.current.onExpand(data.group) })
      instance.on('tap', 'edge', event => { const data = event.target.data(); if (data.relation) { latest.current.onOpen(data.source.replace(/^file:/, ''), data.relation); latest.current.onRelation?.(data.relation) } })
      instance.on('mouseover', 'node', event => { const target = event.target; const label = target.data('type') === 'file' ? readNodeLabel(target) : null; setHovered(label); highlightNeighborhood(instance!, target) })
      instance.on('mouseout', 'node', () => { setHovered(null); restoreSelectedNeighborhood(instance!) })
      instance.on('mouseover', 'edge', event => { event.target.addClass('is-hovered') })
      instance.on('mouseout', 'edge', event => { event.target.removeClass('is-hovered') })
      instance.on('select', 'node', event => { const label = event.target.data('type') === 'file' ? readNodeLabel(event.target) : null; setHovered(label); highlightNeighborhood(instance!, event.target) })
      instance.on('unselect', 'node', () => { setHovered(null); restoreSelectedNeighborhood(instance!) })
      instance.on('dragfree', 'node', event => { const target = event.target; latest.current.onPositions?.({ ...Object.fromEntries(instance!.nodes().map(node => [node.id(), { ...node.position() }])), [target.id()]: { x: target.position('x'), y: target.position('y') } }) })
      instance.on('pan zoom', () => { const current = graph.current; if (current) latest.current.onViewport({ zoom: current.zoom(), pan: current.pan() }) })
      setReady(true)
    }).catch(() => { if (live) setError('关系画布暂不可用，请使用下方文件与关系列表。') })
    return () => { live = false; observer?.disconnect(); instance?.destroy(); graph.current = null; lastStructure.current = '' }
  }, [])
  useEffect(() => {
    const instance = graph.current
    if (!instance) return
    const existingPositions = Object.fromEntries(instance.nodes().map(node => [node.id(), node.position()]))
    const old = new Set(instance.elements().map(element => element.id()))
    const next = new Set([...nodes.map(node => node.data.id), ...edges.map(edge => edge.data.id)])
    instance.batch(() => {
      instance!.elements().forEach(element => { if (!next.has(element.id())) element.remove() })
      for (const node of nodes) {
        const existing = instance!.getElementById(node.data.id)
        if (existing.length) existing.data(node.data)
        else instance!.add({ group: 'nodes', data: node.data, position: node.position })
      }
      for (const edge of edges) {
        const existing = instance!.getElementById(edge.data.id)
        if (existing.length) existing.data(edge.data)
        else instance!.add({ group: 'edges', data: edge.data })
      }
    })
    const structure = `${view}|${nodes.map(node => node.data.id).sort().join('|')}|${edges.map(edge => `${edge.data.id}:${edge.data.source}:${edge.data.target}`).sort().join('|')}`
    const viewChanged = previousView.current !== view
    previousView.current = view
    if (viewport) { instance.zoom(viewport.zoom); instance.pan(viewport.pan) }
    if (structure !== lastStructure.current && nodes.length) {
      lastStructure.current = structure
      const saved = { ...(positions ?? {}) }
      if (!viewChanged) old.forEach(id => { if (existingPositions[id]) saved[id] = existingPositions[id] })
      const laidOut = layoutGraph(nodes, edges, saved)
      const nextPositions = Object.fromEntries(laidOut.map(node => [node.data.id, node.position]))
      instance.batch(() => laidOut.forEach(node => { const existing = instance!.getElementById(node.data.id); if (existing.length) existing.position(node.position) }))
      latest.current.onPositions?.(nextPositions)
      if (!viewport) fitReadable(instance)
      setHovered(null)
      instance.elements().removeClass('is-dimmed is-neighbor is-hovered')
    }
    restoreSelectedNeighborhood(instance)
  }, [nodes, edges, view, viewport, ready, positions])
  const zoom = (factor: number) => { const current = graph.current; if (current) current.zoom({ level: Math.max(.2, current.zoom() * factor), renderedPosition: { x: current.width() / 2, y: current.height() / 2 } }) }
  return <section className="graph-canvas-wrap" aria-label="关系画布"><div className="graph-canvas-tools"><button className="button secondary" onClick={() => zoom(1.2)} aria-label="放大画布">+</button><button className="button secondary" onClick={() => zoom(.83)} aria-label="缩小画布">−</button><button className="button secondary" onClick={() => { const current = graph.current; if (current) { fitReadable(current); onViewport({ zoom: current.zoom(), pan: current.pan() }) } }}>适合画布</button><button className="button secondary" onClick={() => { const current = graph.current; if (current) { current.reset(); fitReadable(current); onViewport({ zoom: current.zoom(), pan: current.pan() }) } }}>重置视图</button></div><div ref={host} className="graph-canvas" role="img" aria-label="归档分类和资料关系图" />{hovered ? <p className="graph-hover-status" role="status" aria-label="当前聚焦文件">当前聚焦文件：{hovered}</p> : null}{error ? <p role="status">{error}</p> : !ready ? <p className="graph-canvas-loading" role="status">正在加载本机关系画布…</p> : null}</section>
}
function fitReadable(instance: cytoscape.Core) {
  instance.fit(undefined, 54)
  if (instance.zoom() < .2) instance.zoom(.2)
}

function highlightNeighborhood(instance: cytoscape.Core, node: cytoscape.NodeSingular) {
  const all = instance.elements()
  all.removeClass('is-dimmed is-neighbor is-hovered')
  node.addClass('is-hovered')
  const neighbors = node.neighborhood()
  neighbors.addClass('is-neighbor')
  all.difference(node.union(neighbors)).addClass('is-dimmed')
}

function restoreSelectedNeighborhood(instance: cytoscape.Core) {
  const selected = instance.$('node:selected, node[?focused]').nodes().first()
  if (selected.length) highlightNeighborhood(instance, selected)
  else instance.elements().removeClass('is-dimmed is-neighbor is-hovered')
}

function readNodeLabel(node: cytoscape.NodeSingular) {
  const value = node.data('label')
  return typeof value === 'string' ? value : typeof value?.label === 'string' ? value.label : null
}



