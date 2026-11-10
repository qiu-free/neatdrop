/** Reproducible manifest of already-built public static files, no source upload. */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve('frontend/dist-experience'), rows = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else { const bytes = await readFile(path); rows.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }) }
  }
}
await walk(root)
rows.sort((a, b) => a.path.localeCompare(b.path))
const manifest = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), generated: new Date().toISOString(), public_deployment: 'not_performed', files: rows }
await mkdir('.cache', { recursive: true })
await writeFile('.cache/experience-build-manifest.json', JSON.stringify(manifest, null, 2))
console.log(`Static manifest: ${rows.length} files, ${rows.reduce((sum, row) => sum + row.bytes, 0)} bytes; publication not performed.`)
