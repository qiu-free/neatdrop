import { readdir, readFile } from 'node:fs/promises'
const files = await readdir('dist/assets')
const modules = await Promise.all(files.filter(name => name.endsWith('.js')).map(name => readFile(`dist/assets/${name}`, 'utf8')))
const text = modules.join('\n')
for (const forbidden of ['notes-optics', 'experiment-optics', 'web-study-1', '体验资料库/', '网页体验 / 学习资料']) {
  if (text.includes(forbidden)) throw new Error(`Browser dataset leaked into local build: ${forbidden}`)
}
if (files.some(name => name.startsWith('classify.worker'))) throw new Error('Browser Worker leaked into local build')
if (!text.includes('/api/v1') || !text.includes('X-NeatDrop-CSRF')) throw new Error('Local transport missing')
console.log('Local bundle verified: local transport present; browser fixtures and Worker excluded.')
