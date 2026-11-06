import { createGraphSession, rememberGraphPositions, transitionGraphView } from './graphTypes'
it('stores the current mode viewport and restores the destination mode viewport', () => {
  const session = createGraphSession('ws')
  const categoryView = { zoom: 1.2, pan: { x: 10, y: 20 } }, relationView = { zoom: 1.5, pan: { x: 30, y: 40 } }
  session.viewport = categoryView
  expect(transitionGraphView(session, 'categories', 'relations')).toBeNull()
  session.viewport = relationView
  expect(transitionGraphView(session, 'relations', 'categories')).toEqual(categoryView)
  expect(transitionGraphView(session, 'categories', 'relations')).toEqual(relationView)
})
it('keeps hidden dragged positions through filtering and bounds independent view caches', () => {
  const session = createGraphSession('ws')
  rememberGraphPositions(session, 'categories', { hidden: { x: 310, y: 220 }, visible: { x: 0, y: 0 } })
  rememberGraphPositions(session, 'categories', { visible: { x: 10, y: 20 } })
  expect(session.positions?.categories.hidden).toEqual({ x: 310, y: 220 })
  rememberGraphPositions(session, 'relations', { visible: { x: 900, y: 800 } })
  expect(session.positions?.categories.visible).toEqual({ x: 10, y: 20 })
  expect(session.positions?.relations.visible).toEqual({ x: 900, y: 800 })
  rememberGraphPositions(session, 'categories', Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`file:${i}`, { x: i, y: i }])))
  expect(Object.keys(session.positions!.categories)).toHaveLength(400)
})
