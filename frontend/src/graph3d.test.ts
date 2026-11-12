import { moveGraphPoint, projectGraphPoint, rotateGraphPoint, seedGraphDepth, fitGraphCamera, zoomGraphCamera } from './graph3d'

const camera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: { yaw: 0, pitch: 0 } }
const size = { width: 800, height: 500 }

it('rotates world depth into horizontal displacement instead of tilting a flat surface', () => {
  expect(rotateGraphPoint({ x: 0, y: 0, z: 100 }, { yaw: Math.PI / 2, pitch: 0 })).toMatchObject({ x: 100, y: 0 })
  const point = rotateGraphPoint({ x: 100, y: 0, z: 0 }, { yaw: Math.PI / 2, pitch: 0 })
  expect(point.z).toBeCloseTo(-100)
  expect(point.x).toBeCloseTo(0)
})

it('makes near nodes larger and farther apart while keeping all projections finite', () => {
  const near = projectGraphPoint({ x: 100, y: 0, z: 200 }, camera, size)
  const far = projectGraphPoint({ x: 100, y: 0, z: -200 }, camera, size)
  expect(near.x).toBeGreaterThan(far.x)
  expect(near.scale).toBeGreaterThan(far.scale)
  for (const z of [-10000, 0, 10000]) {
    const result = projectGraphPoint({ x: 20, y: 10, z }, camera, size)
    expect(Number.isFinite(result.x) && Number.isFinite(result.scale)).toBe(true)
  }
})

it('maps a node drag back into world coordinates at any camera angle and zoom', () => {
  const point = { x: 80, y: -30, z: 120 }, angled = { ...camera, zoom: .8, rotation: { yaw: .8, pitch: -.4 } }
  const before = projectGraphPoint(point, angled, size)
  const moved = moveGraphPoint(point, 50, -20, angled)
  const after = projectGraphPoint(moved, angled, size)
  expect(after.x - before.x).toBeCloseTo(50)
  expect(after.y - before.y).toBeCloseTo(-20)
  expect(moved.z).not.toBe(point.z)
})

it('seeds stable depth by identity regardless of filtering and fits a rotated scene inside its label padding', () => {
  expect(seedGraphDepth('file:one')).toBe(seedGraphDepth('file:one'))
  expect(seedGraphDepth('file:one')).not.toBe(seedGraphDepth('file:two'))
  const points = [{ x: -400, y: -200, z: -150 }, { x: 400, y: 200, z: 150 }]
  const fit = fitGraphCamera(points, size, { yaw: 1, pitch: .5 })
  for (const point of points) {
    const projected = projectGraphPoint(point, fit, size)
    expect(projected.x).toBeGreaterThanOrEqual(70)
    expect(projected.x).toBeLessThanOrEqual(730)
    expect(projected.y).toBeGreaterThanOrEqual(65)
    expect(projected.y).toBeLessThanOrEqual(410)
  }
})

it('zooms about a chosen point and bounds repeated wheel input', () => {
  const zoom = zoomGraphCamera(camera, 2, { x: 100, y: 50 })
  expect(zoom.pan.x).toBeCloseTo(-129.73967)
  expect(zoom.pan.y).toBeCloseTo(-64.86984)
  expect(zoomGraphCamera(camera, 1000).zoom).toBe(2.8)
  expect(zoomGraphCamera(camera, .0001).zoom).toBe(.2)
  expect(fitGraphCamera([], { width: 0, height: 0 }).zoom).toBe(1)
})

it('brings branches closer when zoomed out and separates them more when zoomed in', () => {
  const left = { x: -100, y: 0, z: 0 }, right = { x: 100, y: 0, z: 0 }
  const small = { ...camera, zoom: .5 }, large = { ...camera, zoom: 2 }
  expect(projectGraphPoint(right, small, size).x - projectGraphPoint(left, small, size).x).toBeCloseTo(87.05506)
  expect(projectGraphPoint(right, large, size).x - projectGraphPoint(left, large, size).x).toBeCloseTo(459.47934)
})
