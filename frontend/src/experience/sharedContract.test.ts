import { classifyText } from './textClassifier'
import fixture from './sharedContract.generated.json'
it('matches production purpose labels on the explicitly shared subset while retaining browser review', () => {
  for (const row of fixture.cases) {
    const result = classifyText(row.id, 'misleading-invoice.txt', row.text)
    expect([result.category, result.subcategory], row.id).toEqual([row.category, row.subcategory])
    expect(result.review_required).toBe(true)
  }
})
