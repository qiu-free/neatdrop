import type { ExperienceFile } from './dataset'

export async function readTextFiles(files: File[], signal?: AbortSignal): Promise<ExperienceFile[]> {
  signal?.throwIfAborted()
  if (!files.length || files.length > 10) throw new Error('请选择1至10份 TXT 或 Markdown 文本。')
  if (files.reduce((sum, file) => sum + file.size, 0) > 2 * 1024 ** 2) throw new Error('文本合计不能超过2 MiB。')
  const result: ExperienceFile[] = []
  for (const [index, file] of files.entries()) {
    if (!/\.(txt|md)$/i.test(file.name)) throw new Error('网页只支持 UTF-8 TXT / Markdown；其他格式请使用本地版。')
    if (!file.size || file.size > 512 * 1024) throw new Error('文本须非空且每份不超过512 KiB。')
    if (file.name.length > 150 || /[\\/\x00-\x1f]/.test(file.name)) throw new Error('文件名称不合法。')
    const bytes = await file.arrayBuffer()
    signal?.throwIfAborted()
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('文件不是有效 UTF-8 文本，请转换编码后重试。') }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('文件包含二进制控制字符。')
    result.push({ id: `import-${index}-${crypto.randomUUID()}`, name: file.name, text })
  }
  return result
}
