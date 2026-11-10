import type { LibraryItem } from '../types'

export function exportManifest(items: LibraryItem[], format: 'json' | 'csv') {
  const rows = items.map(({ name, category, subcategory, target }) => ({ name, category, subcategory, target, runtime: 'browser-memory' }))
  if (format === 'json') return JSON.stringify({ version: 1, note: '浏览器整理清单；没有生成真实文件副本。', items: rows }, null, 2)
  const cell = (value: unknown) => '"' + String(value ?? '').replace(/^[\s\uFEFF]*([=+\-@\t\r])/, "'$1").replaceAll('"', '""') + '"'
  return '\uFEFF' + ['名称,分类,子类,建议位置,运行环境', ...rows.map(row => [row.name, row.category, row.subcategory, row.target, row.runtime].map(cell).join(','))].join('\r\n')
}

export function downloadManifest(items: LibraryItem[], format: 'json' | 'csv') {
  const url = URL.createObjectURL(new Blob([exportManifest(items, format)], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `neatdrop-organizing-plan.${format}`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
