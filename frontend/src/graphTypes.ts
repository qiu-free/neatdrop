import type { LibraryItem } from './types'
import type { GraphVisualSettings } from './graphSettings'
export type GraphDimension = '2d' | '3d'
export type GraphKind = 'duplicate' | 'text_similar' | 'visual_similar' | 'related' | 'reference' | 'attachment' | 'version'
export interface GraphRelation { id: string; source: string; target: string; kind: GraphKind; status: 'fact' | 'suggested' | 'confirmed'; origin: 'archive' | 'automatic' | 'manual'; created: string; score?: number; keywords?: string[]; root_id?: string }
export interface GraphListing { items: LibraryItem[]; relations: GraphRelation[]; truncated: boolean; index: { count: number; revision: number; updated: string | null; state: 'empty' | 'ready' | 'unavailable'; issues: { entry_id: string; code: string }[] } }
export interface GraphJob { id: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; processed: number; total: number; current_file: string | null; errors: { entry_id: string; code: string }[]; error?: string | null }
export interface GraphEvidence { relation: GraphRelation; files: { id: string; name: string; excerpts: string[]; summary: string }[]; explanation: string }
export interface GraphViewport { zoom: number; pan: { x: number; y: number }; rotation?: { yaw: number; pitch: number } }
export interface GraphPosition { x: number; y: number; z?: number }
export interface GraphSession { workspace: string | null; query: string; category: string; kind: GraphKind | 'all'; view: 'categories' | 'relations'; focus: string | null; expanded: Record<string, number>; viewport: GraphViewport | null; dimension?: GraphDimension; visual?: GraphVisualSettings; positions?: { categories: Record<string, GraphPosition>; relations: Record<string, GraphPosition> }; viewports?: { categories: GraphViewport | null; relations: GraphViewport | null }; dimensionViewports?: Record<GraphDimension, { categories: GraphViewport | null; relations: GraphViewport | null }>; job?: GraphJob | null; catalogJobPath?: string | null }
export const graphKindLabels: Record<GraphKind, string> = { duplicate: '归档时内容相同', text_similar: '文本相似候选', visual_similar: '图像相似候选', related: '相关资料', reference: '引用', attachment: '配套说明', version: '后续版本' }
export function createGraphSession(workspace: string | null = null): GraphSession { return { workspace, query: '', category: 'all', kind: 'all', view: 'categories', focus: null, expanded: {}, viewport: null, dimension: '2d', positions: { categories: {}, relations: {} }, viewports: { categories: null, relations: null }, dimensionViewports: { '2d': { categories: null, relations: null }, '3d': { categories: null, relations: null } }, job: null } }
function cameraCache(session: GraphSession) {
  session.viewports ??= { categories: null, relations: null }
  session.dimensionViewports ??= { '2d': session.viewports, '3d': { categories: null, relations: null } }
  if (session.dimensionViewports['2d'] !== session.viewports) session.dimensionViewports['2d'] = session.viewports
  return session.dimensionViewports[session.dimension ?? '2d']
}
export function transitionGraphView(session: GraphSession, current: GraphSession['view'], next: GraphSession['view']) {
  const cache = cameraCache(session)
  cache[current] = session.viewport
  session.view = next
  session.viewport = cache[next]
  if ((session.dimension ?? '2d') === '2d') session.viewports = cache
  return session.viewport
}
export function transitionGraphDimension(session: GraphSession, next: GraphDimension): GraphViewport | null {
  const current = cameraCache(session)
  current[session.view] = session.viewport
  session.dimension = next
  session.viewport = cameraCache(session)[session.view]
  session.viewports = session.dimensionViewports!['2d']
  return session.viewport
}
/** Retain hidden positions for filter/collapse round trips, with a hard per-view bound. */
export function rememberGraphPositions(session: GraphSession, view: GraphSession['view'], incoming: Record<string, GraphPosition>) {
  session.positions ??= { categories: {}, relations: {} }
  const prior = Object.entries(session.positions[view]).filter(([id]) => !(id in incoming))
  session.positions[view] = Object.fromEntries([...prior, ...Object.entries(incoming)].slice(-400))
}
