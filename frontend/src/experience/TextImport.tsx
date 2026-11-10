import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { readTextFiles } from './imports'
import { experienceEngine } from './engine'
import { IMPORT_PATH } from './dataset'

export function TextImport({ onImported, disabled, hasWorkspace }: { onImported: (path: string) => void; disabled: boolean; hasWorkspace: boolean }) {
  const input = useRef<HTMLInputElement>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  return <div className="experience-import"><button type="button" className="button secondary" disabled={disabled || busy} onClick={() => input.current?.click()}><FileUp size={16} />{busy ? '正在读取文本…' : '选择自己的文本'}</button><span>TXT / Markdown · 最多10份 · 每份512 KiB · 合计2 MiB</span><input ref={input} type="file" accept=".txt,.md,text/plain,text/markdown" multiple hidden onChange={async event => {
    const files = [...event.currentTarget.files ?? []]; event.currentTarget.value = ''; if (!files.length) return
    if (hasWorkspace && !confirm('切换到自选文本会清空本页的建议和体验结果，原文件不会改变。继续？')) return
    setBusy(true); setError('')
    try { const result = await readTextFiles(files); experienceEngine.installFiles(result); onImported(IMPORT_PATH) } catch (reason) { setError(reason instanceof Error ? reason.message : '文本读取失败。') } finally { setBusy(false) }
  }} />{error ? <p role="alert">{error}</p> : null}</div>
}
