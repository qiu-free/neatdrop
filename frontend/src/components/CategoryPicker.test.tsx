import { fireEvent, render, screen } from '@testing-library/react'
import { CategoryPicker } from './CategoryPicker'
import { TaxonomyProvider } from '../taxonomy'

it('searches server categories and applies an explicit destination without approving it', () => {
  const change = vi.fn()
  render(<TaxonomyProvider taxonomy={{ study: { label: '学习科研', directory: '02_学习科研', subcategories: { data_chart: '数据图表', paper: '论文文献' }, descriptions: { data_chart: '实验、教学或研究中的数据可视化。' } } }}>
    <CategoryPicker category="study" subcategory={null} onChange={change} />
  </TaxonomyProvider>)
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索归档分类' }), { target: { value: '图表' } })
  expect(screen.getByRole('button', { name: /学习科研.*数据图表/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /论文文献/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /学习科研.*数据图表/ }))
  expect(change).toHaveBeenCalledExactlyOnceWith('study', 'data_chart')
})

it('shows no matches and respects the analysis lock for search and changes', () => {
  const change = vi.fn()
  const { rerender } = render(<CategoryPicker category="study" subcategory={null} onChange={change} />)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的类别xyz' } })
  expect(screen.getByText('没有匹配分类，请换一个关键词。')).toBeInTheDocument()
  rerender(<CategoryPicker category="study" subcategory={null} onChange={change} disabled />)
  expect(screen.getByRole('searchbox')).toBeDisabled()
  expect(screen.getByLabelText('归档主分类')).toBeDisabled()
  expect(change).not.toHaveBeenCalled()
})
