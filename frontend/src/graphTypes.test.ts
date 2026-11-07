import { createGraphSession, rememberGraphPositions, transitionGraphDimension, transitionGraphView } from './graphTypes'
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
it('round trips independent cameras for both views in 2D and 3D', () => {
  const session = createGraphSession('ws')
  const category2d = { zoom: 1.2, pan: { x: 10, y: 20 } }
  const relation2d = { zoom: 1.3, pan: { x: 30, y: 40 } }
  const category3d = { zoom: .8, pan: { x: -5, y: 9 }, rotation: { yaw: 1, pitch: .5 } }
  const relation3d = { zoom: .9, pan: { x: 6, y: 7 }, rotation: { yaw: 2, pitch: .2 } }
  session.viewport = category2d
  transitionGraphView(session, 'categories', 'relations')
  session.viewport = relation2d
  expect(transitionGraphDimension(session, '3d')).toBeNull()
  session.viewport = relation3d
  expect(transitionGraphView(session, 'relations', 'categories')).toBeNull()
  session.viewport = category3d
  expect(transitionGraphDimension(session, '2d')).toEqual(category2d)
  expect(transitionGraphView(session, 'categories', 'relations')).toEqual(relation2d)
  expect(transitionGraphDimension(session, '3d')).toEqual(relation3d)
  expect(transitionGraphView(session, 'relations', 'categories')).toEqual(category3d)
})
