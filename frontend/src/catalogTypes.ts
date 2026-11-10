import type { GraphListing } from './graphTypes'
import type { LibraryItem } from './types'
export interface CatalogRoot { id: string; alias: string; status: 'authorized' | 'pending_reauthorization' | 'offline' | 'permission_denied' | 'identity_changed'; workspace_id?: string; manual_relation_count: number }
export interface CatalogRegistry { version: number; revision: number; relations_revision: number; roots: CatalogRoot[] }
export interface CatalogListing extends GraphListing { total: number; offset: number; limit: number; next_offset: number | null; roots: CatalogRoot[]; related_items?: LibraryItem[]; primary_count?: number; relations_truncated?: boolean; verification?: { limited: boolean; bytes: number } }
