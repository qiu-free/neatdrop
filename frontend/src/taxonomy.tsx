import { createContext, useContext, useMemo, type ReactNode } from 'react'
import snapshot from './taxonomy.generated.json'
import type { Category, Taxonomy, TaxonomyGroup } from './types'

const defaults = { taxonomy: snapshot.taxonomy as Taxonomy, contentForms: snapshot.content_forms as Record<string, string> }
const TaxonomyContext = createContext(defaults)
export function TaxonomyProvider({ taxonomy, contentForms, children }: { taxonomy?: Taxonomy; contentForms?: Record<string, string>; children: ReactNode }) {
  const value = useMemo(() => ({ taxonomy: taxonomy && Object.keys(taxonomy).length ? taxonomy : defaults.taxonomy,
    contentForms: contentForms ?? defaults.contentForms }), [taxonomy, contentForms])
  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>
}
export function useTaxonomy() {
  const { taxonomy, contentForms } = useContext(TaxonomyContext)
  return useMemo(() => ({ taxonomy, contentForms,
    categories: Object.fromEntries(Object.entries(taxonomy).map(([id, group]) => [id, group!.label])) as Record<Category, string>,
    subcategories: Object.fromEntries(Object.entries(taxonomy).map(([id, group]) => [id, group!.subcategories])) as Record<Category, Record<string, string>>,
  }), [taxonomy, contentForms])
}
export function groupEntries(taxonomy: Taxonomy) { return Object.entries(taxonomy) as [Category, TaxonomyGroup][] }
