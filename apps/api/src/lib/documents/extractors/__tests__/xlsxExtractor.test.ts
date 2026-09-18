import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { xlsxExtractor } from '../xlsxExtractor.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../../tests/fixtures/documents')

describe('xlsxExtractor (Phase 6 §9/§21)', () => {
  it('extracts one page per worksheet, preserving row/column structure as a table', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'pricing-schedule.xlsx'))
    const result = await xlsxExtractor.extract(bytes)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.extractionMethod).toBe('STRUCTURED')
    expect(result.pages[0]!.text).toContain('Pricing Schedule')
    expect(result.tables).toHaveLength(1)
    expect(result.tables[0]!.rows[0]).toEqual(['Item', 'Description', 'Quantity', 'Unit Price (ZAR)', 'Total (ZAR)'])
    expect(result.tables[0]!.rows.some((row) => row.includes('Synthetic widget'))).toBe(true)
  })
})
