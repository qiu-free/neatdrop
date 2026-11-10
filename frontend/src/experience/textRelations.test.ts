import { matchTexts } from './textRelations'

it('finds real shared subject terms and does not connect files only because their category matches', () => {
  const result = matchTexts([
    { id: 'a', text: '光学透镜的焦距测量，凸透镜与物距像距的实验观测，光源位置保持稳定。' },
    { id: 'b', text: '凸透镜焦距测量使用光学平台，记录物距像距变化，观测光源成像。' },
    { id: 'c', text: '现代文学的叙事结构与人物心理，小说阅读强调语言细节和作者背景。' },
  ])
  expect(result.some(item => item.source === 'a' && item.target === 'b' && item.status === 'suggested')).toBe(true)
  expect(result.every(item => item.source !== 'c' && item.target !== 'c')).toBe(true)
  expect(result[0].keywords?.length).toBeGreaterThanOrEqual(3)
})

it('labels identical actual text as an equality fact and handles low-information records', () => {
  const result = matchTexts([{ id: 'a', text: '矩阵理论与线性代数的课程内容' }, { id: 'b', text: '矩阵理论与线性代数的课程内容' }, { id: 'c', text: '' }])
  expect(result[0]).toMatchObject({ source: 'a', target: 'b', kind: 'duplicate', status: 'fact' })
  expect(matchTexts([{ id: 'a', text: '示例文档内容' }, { id: 'b', text: '示例文档内容不同' }])).toHaveLength(0)
})
