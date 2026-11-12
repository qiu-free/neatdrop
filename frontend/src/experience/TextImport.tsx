import { useEffect, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { readTextFiles } from './imports'
import { experienceEngine } from './engine'
import { IMPORT_PATH } from './dataset'

export type ImportTransition = (path: string, prepare?: () => Promise<void>, signal?: AbortSignal) => Promise<unknown>
export function TextImport({ onImported, disabled, hasWorkspace }: { onImported: ImportTransition; disabled: boolean; hasWorkspace: boolean }) {
  const input = useRef<HTMLInputElement>(null), pending = useRef<AbortController | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => () => pending.current?.abort(), [])
  async function load(files: File[]) {
    if (!files.length || disabled || busy) return
    if (hasWorkspace && !confirm('切换到自选文本会清空本页的建议和体验结果，原文件不会改变。继续？')) return
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError('')
    try {
      await onImported(IMPORT_PATH, async () => {
        const result = await readTextFiles(files, controller.signal)
        controller.signal.throwIfAborted()
        if (pending.current !== controller) throw new DOMException('导入已被替代', 'AbortError')
        experienceEngine.installFiles(result)
      }, controller.signal)
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '文本读取失败。')
    } finally {
      if (!controller.signal.aborted && pending.current === controller) setBusy(false)
    }
  }
  return <div className="experience-import"><button type="button" className="button secondary" disabled={disabled || busy} onClick={() => input.current?.click()}><FileUp size={16} />{busy ? '正在读取文本…' : '选择自己的文本'}</button><span>TXT / Markdown · 最多10份 · 每份512 KiB · 合计2 MiB</span><input ref={input} type="file" accept=".txt,.md,text/plain,text/markdown" multiple hidden onChange={event => { const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; void load(files) }} />{error ? <p role="alert">{error}</p> : null}</div>
}
