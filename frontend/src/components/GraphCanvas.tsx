import { useEffect, useRef, useState } from 'react'
import type cytoscape from 'cytoscape'
import type { GraphEdge, GraphNode } from '../graphProjection'
import './graph.css'
export function GraphCanvas({ nodes, edges, onOpen, onRelation, viewport, onViewport, onExpand, expanded }: { nodes: GraphNode[]; edges: GraphEdge[]; onOpen: (entry: string, relation?: string) => void; onRelation?: (relation: string) => void; viewport: { zoom: number; pan: { x: number; y: number } } | null; onViewport: (value: { zoom: number; pan: { x: number; y: number } }) => void; onExpand: (group: string) => void; expanded: Record<string, number> }) {
  const host = useRef<HTMLDivElement>(null), graph = useRef<cytoscape.Core | null>(null), latest = useRef({ onOpen, onRelation, onViewport, onExpand, expanded })
  const positioned = useRef(false)
  const [error, setError] = useState(''), [ready, setReady] = useState(false)
  latest.current = { onOpen, onRelation, onViewport, onExpand, expanded }
  useEffect(() => {
    let live = true, instance: cytoscape.Core | null = null, observer: ResizeObserver | null = null
    import('cytoscape').then(({ default: cytoscape }) => {
      if (!live || !host.current) return
      instance = cytoscape({ container: host.current, elements: [], minZoom: .2, maxZoom: 2.5, wheelSensitivity: .2, style: [
        { selector: 'node', style: { label: 'data(label)', color: '#18352a', 'font-size': 13, 'font-family': 'system-ui, sans-serif', 'text-wrap': 'wrap', 'text-max-width': '150px', width: 'label', height: 'label', padding: '13px', 'background-color': '#edf4ee', 'border-color': '#73917f', 'border-width': 1, shape: 'round-rectangle', 'text-valign': 'center', 'text-halign': 'center' } },
        { selector: 'node[type="root"]', style: { shape: 'ellipse', 'background-color': '#286346', color: 'white', 'font-weight': 'bold' } },
        { selector: 'node[type="category"]', style: { shape: 'round-rectangle', 'background-color': '#dcebe0', 'border-width': 2, 'font-weight': 'bold' } },
        { selector: 'node[type="subcategory"]', style: { shape: 'diamond', 'background-color': '#f7edce', 'border-color': '#ac8951' } },
        { selector: 'node:selected', style: { 'border-color': '#145c3a', 'border-width': 4 } },
        { selector: 'node[?focused]', style: { 'background-color': '#d4ead9', 'border-color': '#145c3a', 'border-width': 3, 'font-weight': 'bold' } },
        { selector: 'edge[kind="tree"]', style: { width: 1, 'line-color': '#bfd0c3', 'target-arrow-shape': 'none', 'curve-style': 'straight' } },
        { selector: 'edge[kind!="tree"]', style: { width: 2, 'line-color': '#4d8870', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#4d8870', 'line-style': 'solid', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 13, color: '#345b48', 'text-background-color': 'white', 'text-background-opacity': .9 } },
        { selector: 'edge[status="suggested"]', style: { 'line-style': 'dashed' } },
        { selector: 'edge[kind="related"], edge[kind="duplicate"], edge[kind="text_similar"], edge[kind="visual_similar"]', style: { 'target-arrow-shape': 'none' } },
      ], layout: { name: 'preset' }, userZoomingEnabled: true, userPanningEnabled: true })
      graph.current = instance
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => instance?.resize()); observer.observe(host.current) }
      instance.on('tap', 'node', event => { const node = event.target, data = node.data(); if (data.entry) latest.current.onOpen(data.entry); else if (data.group) latest.current.onExpand(data.group) })
      instance.on('tap', 'edge', event => { const data = event.target.data(); if (data.relation) { latest.current.onOpen(data.source.replace(/^file:/, ''), data.relation); latest.current.onRelation?.(data.relation) } })
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
    if (viewport) { instance.zoom(viewport.zoom); instance.pan(viewport.pan) }
    if (!positioned.current && nodes.length) {
      positioned.current = true
      if (!viewport) instance.fit(undefined, 45)
    }
  }, [nodes, edges, viewport, ready])
  const zoom = (factor: number) => { const current = graph.current; if (current) current.zoom({ level: current.zoom() * factor, renderedPosition: { x: current.width() / 2, y: current.height() / 2 } }) }
  return <section className="graph-canvas-wrap" aria-label="关系画布"><div className="graph-canvas-tools"><button className="button secondary" onClick={() => zoom(1.2)} aria-label="放大画布">+</button><button className="button secondary" onClick={() => zoom(.83)} aria-label="缩小画布">−</button><button className="button secondary" onClick={() => { if (graph.current) { graph.current.fit(undefined, 45); const current = graph.current; onViewport({ zoom: current.zoom(), pan: current.pan() }) } }}>适合画布</button><button className="button secondary" onClick={() => { graph.current?.reset(); graph.current?.fit(undefined, 45); onViewport({ zoom: graph.current?.zoom() ?? 1, pan: graph.current?.pan() ?? { x: 0, y: 0 } }) }}>重置视图</button></div><div ref={host} className="graph-canvas" role="img" aria-label="归档分类和资料关系图" />{error ? <p role="status">{error}</p> : !ready ? <p className="graph-canvas-loading" role="status">正在加载本机关系画布…</p> : null}</section>
}



