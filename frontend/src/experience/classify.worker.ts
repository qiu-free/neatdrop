import { classifyText } from './textClassifier'
import { matchTexts } from './textRelations'
import type { TextRecord } from './textRelations'

type Request = { id: number; task: 'classify'; payload: { id: string; name: string; text: string } } | { id: number; task: 'relations'; payload: TextRecord[] }
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const result = request.task === 'classify' ? classifyText(request.payload.id, request.payload.name, request.payload.text) : matchTexts(request.payload)
    self.postMessage({ id: request.id, result })
  } catch { self.postMessage({ id: request.id, error: '浏览器文本计算未完成。' }) }
}
