import { createGraphSession, transitionGraphView } from './graphTypes'
it('stores the current mode viewport and restores the destination mode viewport', () => {
  const session = createGraphSession('ws')
  const categoryView = { zoom: 1.2, pan: { x: 10, y: 20 } }, relationView = { zoom: 1.5, pan: { x: 30, y: 40 } }
  session.viewport = categoryView
  expect(transitionGraphView(session, 'categories', 'relations')).toBeNull()
  session.viewport = relationView
  expect(transitionGraphView(session, 'relations', 'categories')).toEqual(categoryView)
  expect(transitionGraphView(session, 'categories', 'relations')).toEqual(relationView)
})
