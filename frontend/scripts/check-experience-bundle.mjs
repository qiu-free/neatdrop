import { readdir, readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const root = resolve('dist-experience')
const files = []
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else files.push(path)
  }
}
await visit(root)
const scripts = await Promise.all(files.filter(path => extname(path) === '.js').map(path => readFile(path, 'utf8')))
const combined = scripts.join('\n')
for (const forbidden of ['/api/v1', '/api/session', 'neatdrop_session', 'X-NeatDrop-CSRF', '/model-config']) {
  if (combined.includes(forbidden)) throw new Error(`Local transport leaked into browser build: ${forbidden}`)
}
if (!combined.includes('web-experience')) throw new Error('Missing browser runtime capability marker')
console.log(`Experience bundle verified: ${files.length} static files; no local API transport.`)
