import { api } from './api'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['OFFICE_INVALID_CONTAINER', /Office.*损坏/],
  ['OFFICE_FORMAT_MISMATCH', /扩展名.*内容/],
  ['OFFICE_ENCRYPTED', /加密/],
  ['OFFICE_UNSAFE_CONTENT', /宏|外链|嵌入/],
  ['OFFICE_ZIP_LIMIT', /解压.*限制/],
  ['OFFICE_XML_UNSAFE', /不安全.*XML/],
  ['OFFICE_XML_LIMIT', /XML.*限制/],
  ['OFFICE_PARSE_FAILED', /Office.*读取失败/],
  ['OFFICE_NO_TEXT', /没有可提取文字/],
  ['CSV_INVALID_UTF8', /UTF-8/],
  ['CSV_INVALID', /CSV.*格式/],
  ['CSV_BUDGET', /CSV.*预算/],
  ['CSV_PARSE_FAILED', /CSV.*读取失败/],
  ['CSV_LIMIT', /CSV.*限制/],
  ['CSV_NO_TEXT', /CSV.*没有可提取文字/],
  ['DOCUMENT_PARSE_TIMEOUT', /解析超时/],
  ['DOCUMENT_PARSE_CANCELLED', /取消/],
  ['DOCUMENT_PARSE_FAILED', /文档.*读取失败/],
])('turns parser response %s into a useful action without exposing an enum to the user', async (code, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ code }) })))
  await expect(api('/workspaces/w/files/file/preview')).rejects.toThrow(message)
})
