import type { GraphRelation } from '../graphTypes'

export interface TextRecord { id: string; text: string }
const stop = new Set('课程 学习 笔记 文档 内容 示例 文本 记录 实验 研究 目的 步骤 结果 定义 说明 数据 参考 资料 采用 方法 进行 以及 我们 这个 the and for with from this that notes document results'.split(' '))
function terms(text: string) {
  const counts = new Map<string, number>()
  const normalized = text.slice(0, 12000).normalize('NFKC').toLowerCase().replace(/^\s*#{1,6}[^\n]*$/gm, '')
  for (const match of normalized.matchAll(/[a-z][a-z0-9]{2,39}|[\u3400-\u9fff]+/g)) {
    const pieces = /[\u3400-\u9fff]/.test(match[0]) ? Array.from({ length: Math.max(0, match[0].length - 1) }, (_, i) => match[0].slice(i, i + 2)) : [match[0]]
    for (const word of pieces) if (!stop.has(word) && counts.size < 256) counts.set(word, Math.min(3, (counts.get(word) ?? 0) + 1))
  }
  return counts
}

/** Actual text matching; scores are candidates, never inferred citations or versions. */
export function matchTexts(records: TextRecord[]): GraphRelation[] {
  const files = [...records].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1000)
  const vectors = files.map(file => terms(file.text)), result: GraphRelation[] = [], degrees = new Map<string, number>()
  for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
    const a = files[i], b = files[j]
    if (!a.text.trim() || !b.text.trim()) continue
    const duplicate = a.text === b.text
    const common = [...vectors[i].keys()].filter(term => vectors[j].has(term))
    const dot = common.reduce((sum, term) => sum + vectors[i].get(term)! * vectors[j].get(term)!, 0)
    const norm = (vector: Map<string, number>) => Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0))
    const similarity = dot / Math.max(1, norm(vectors[i]) * norm(vectors[j]))
    if (!duplicate && (common.length < 5 || similarity < .28)) continue
    if ((degrees.get(a.id) ?? 0) >= 5 || (degrees.get(b.id) ?? 0) >= 5) continue
    result.push({ id: `web-text:${a.id}:${b.id}`, source: a.id, target: b.id, kind: duplicate ? 'duplicate' : 'text_similar', status: duplicate ? 'fact' : 'suggested', origin: duplicate ? 'archive' : 'automatic', created: '', keywords: common.slice(0, 8), score: similarity })
    degrees.set(a.id, (degrees.get(a.id) ?? 0) + 1); degrees.set(b.id, (degrees.get(b.id) ?? 0) + 1)
  }
  return result
}
