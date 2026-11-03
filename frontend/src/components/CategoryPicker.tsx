import { useId, useState } from 'react'
import { groupEntries, useTaxonomy } from '../taxonomy'
import type { Category } from '../types'

export function CategoryPicker({ category, subcategory, onChange, disabled = false }: {
  category: Category; subcategory: string | null; onChange: (category: Category, subcategory: string | null) => void; disabled?: boolean
}) {
  const { taxonomy } = useTaxonomy()
  const [query, setQuery] = useState('')
  const [template, setTemplate] = useState('all')
  const id = useId()
  const needle = query.trim().toLocaleLowerCase()
  const matches = groupEntries(taxonomy).flatMap(([groupId, group]) => Object.entries(group.subcategories).map(([subId, label]) => ({ groupId, subId, label, group })))
    .filter(row => (template === 'all' || row.groupId === template) && (!needle || `${row.group.label} ${row.label} ${row.group.descriptions?.[row.subId] ?? ''}`.toLocaleLowerCase().includes(needle)))
  return <div className="category-picker">
    <label htmlFor={`${id}-search`}>搜索归档分类</label>
    <input id={`${id}-search`} type="search" placeholder="例如：图表、合同、保修…" value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} />
    <label htmlFor={`${id}-view`}>常用分类视图</label><select id={`${id}-view`} value={template} disabled={disabled} onChange={e => setTemplate(e.target.value)}><option value="all">通用日常 · 全部分类</option><option value="study">学习科研</option><option value="office">工作项目</option></select>
    {needle || template !== 'all' ? <div className="category-search-results" aria-label="匹配的归档分类">{matches.length ? matches.map(row => <button type="button" key={`${row.groupId}/${row.subId}`} disabled={disabled}
      aria-pressed={category === row.groupId && subcategory === row.subId} onClick={() => onChange(row.groupId, row.subId)}><strong>{row.group.label} / {row.label}</strong><small>{row.group.descriptions?.[row.subId] ?? `${row.group.directory}/${row.label}`}</small></button>) : <p>没有匹配分类，请换一个关键词。</p>}</div> : null}
    <label htmlFor={`${id}-category`}>归档主分类</label><select id={`${id}-category`} value={category} disabled={disabled} onChange={e => onChange(e.target.value as Category, null)}>{groupEntries(taxonomy).map(([key, group]) => <option key={key} value={key}>{group.label}</option>)}</select>
    <label htmlFor={`${id}-subcategory`}>二级分类</label><select id={`${id}-subcategory`} value={subcategory ?? ''} disabled={disabled} onChange={e => onChange(category, e.target.value || null)}><option value="">仅按主分类归档</option>{Object.entries(taxonomy[category]?.subcategories ?? {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
  </div>
}
