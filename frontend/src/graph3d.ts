import type { GraphViewport } from './graphTypes'

export interface GraphPoint3D { x: number; y: number; z: number }
export interface GraphRotation { yaw: number; pitch: number }
export interface GraphCamera extends GraphViewport { rotation: GraphRotation }
export interface GraphSize { width: number; height: number }
const FOCAL_LENGTH = 1200
const straight: GraphRotation = { yaw: 0, pitch: 0 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const zoomScale = (zoom: number) => zoom ** 1.2

/** Depth is visual layout only; it never changes relation strength or creates edges. */
export function seedGraphDepth(id: string) {
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return ((hash >>> 0) % 281) - 140
}

export function rotateGraphPoint(point: GraphPoint3D, rotation: GraphRotation): GraphPoint3D {
  const cy = Math.cos(rotation.yaw), sy = Math.sin(rotation.yaw), cp = Math.cos(rotation.pitch), sp = Math.sin(rotation.pitch)
  const x = point.x * cy + point.z * sy, z = -point.x * sy + point.z * cy
  return { x, y: point.y * cp - z * sp, z: point.y * sp + z * cp }
}

export function projectGraphPoint(point: GraphPoint3D, camera: GraphCamera, size: GraphSize) {
  const rotated = rotateGraphPoint(point, camera.rotation)
  const perspective = FOCAL_LENGTH / Math.max(FOCAL_LENGTH * .35, FOCAL_LENGTH - rotated.z)
  const scale = zoomScale(camera.zoom) * perspective
  return { x: size.width / 2 + camera.pan.x + rotated.x * scale, y: size.height / 2 + camera.pan.y + rotated.y * scale, depth: rotated.z, scale }
}

/** Drag parallel to the camera plane; invert both rotations so depth stays correct. */
export function moveGraphPoint(point: GraphPoint3D, dx: number, dy: number, camera: GraphCamera): GraphPoint3D {
  const scale = projectGraphPoint(point, camera, { width: 0, height: 0 }).scale
  const x = dx / scale, y = dy / scale
  const cp = Math.cos(camera.rotation.pitch), sp = Math.sin(camera.rotation.pitch), cy = Math.cos(camera.rotation.yaw), sy = Math.sin(camera.rotation.yaw)
  const worldY = y * cp, worldZ = -y * sp
  return { x: point.x + x * cy - worldZ * sy, y: point.y + worldY, z: point.z + x * sy + worldZ * cy }
}

export function fitGraphCamera(points: GraphPoint3D[], size: GraphSize, rotation: GraphRotation = straight): GraphCamera {
  if (!points.length || size.width <= 0 || size.height <= 0) return { zoom: 1, pan: { x: 0, y: 0 }, rotation: { ...rotation } }
  const base = { zoom: 1, pan: { x: 0, y: 0 }, rotation }
  const projected = points.map(point => projectGraphPoint(point, base, { width: 0, height: 0 }))
  const minX = Math.min(...projected.map(point => point.x)), maxX = Math.max(...projected.map(point => point.x))
  const minY = Math.min(...projected.map(point => point.y)), maxY = Math.max(...projected.map(point => point.y))
  // Reserve space for upright labels, top controls and the bottom interaction hint.
  const paddingX = Math.min(80, size.width * .23), top = 72, bottom = 90
  const fittedScale = Math.min((size.width - paddingX * 2) / Math.max(180, maxX - minX), (size.height - top - bottom) / Math.max(140, maxY - minY), 1.15)
  const zoom = clamp(Math.max(.01, fittedScale) ** (1 / 1.2), .2, 2.8), scale = zoomScale(zoom)
  return { zoom, pan: { x: -(minX + maxX) / 2 * scale, y: (top - bottom) / 2 - (minY + maxY) / 2 * scale }, rotation: { ...rotation } }
}

/** Anchor is relative to canvas center; regular wheel input remains page scrolling. */
export function zoomGraphCamera(camera: GraphCamera, factor: number, anchor = { x: 0, y: 0 }): GraphCamera {
  const zoom = clamp(camera.zoom * factor, .2, 2.8), ratio = zoomScale(zoom) / zoomScale(camera.zoom)
  return { ...camera, zoom, pan: { x: anchor.x + (camera.pan.x - anchor.x) * ratio, y: anchor.y + (camera.pan.y - anchor.y) * ratio } }
}
