// Older services do not publish this capability; keep their actual seven formats.
const legacyExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.md']
const knownExtensions = new Set([...legacyExtensions, '.docx', '.pptx', '.xlsx', '.csv'])

export function supportedFormats(extensions?: readonly string[]): string {
  const supported = [...new Set((extensions ?? legacyExtensions).map(extension => extension.toLowerCase()).filter(extension => knownExtensions.has(extension)))]
  return `支持 ${supported.map(extension => extension.slice(1).toUpperCase()).join(' / ')}；PDF 需含文本，TXT / MD / CSV 需为 UTF-8。`
}
