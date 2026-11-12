import { readTextFiles } from './imports'

const file = (name: string, text: string | Uint8Array, size?: number) => {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : text
  return { name, size: size ?? data.length, arrayBuffer: async () => data.buffer } as File
}

it('reads actual UTF-8 content and keeps duplicate basenames as different identities', async () => {
  const result = await readTextFiles([file('笔记.md', '实际正文'), file('笔记.md', '另一份正文')])
  expect(result.map(row => row.text)).toEqual(['实际正文', '另一份正文'])
  expect(result[0].id).not.toBe(result[1].id)
})

it('refuses invalid encoding, binary content, unsupported extension and input budgets', async () => {
  for (const files of [[], Array.from({ length: 11 }, () => file('a.txt', 'a')), [file('a.pdf', 'a')], [file('a.txt', new Uint8Array([0xff]))], [file('a.md', 'a\0b')], [file('a.txt', '')], [file('a.txt', 'x', 512 * 1024 + 1)], Array.from({ length: 5 }, () => file('a.md', 'x', 512 * 1024))]) {
    await expect(readTextFiles(files)).rejects.toThrow()
  }
})

it('does not return partially read files after cancellation', async () => {
  const controller = new AbortController()
  const input = file('a.txt', '正文')
  input.arrayBuffer = async () => { controller.abort(); return new ArrayBuffer(0) }
  await expect(readTextFiles([input], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
