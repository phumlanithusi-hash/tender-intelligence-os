import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { docxExtractor } from '../docxExtractor.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../../tests/fixtures/documents')

describe('docxExtractor (Phase 6 §9)', () => {
  it('extracts raw text as a single logical page', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'terms-of-reference.docx'))
    const result = await docxExtractor.extract(bytes)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]!.pageNumber).toBe(1)
    expect(result.pages[0]!.text).toContain('TERMS OF REFERENCE')
    expect(result.pages[0]!.text).toContain('Background')
    expect(result.ocrRequired).toBe(false)
  })
})
