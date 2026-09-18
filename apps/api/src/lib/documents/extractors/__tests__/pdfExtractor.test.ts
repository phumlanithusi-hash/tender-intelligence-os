import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfExtractor } from '../pdfExtractor.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../../tests/fixtures/documents')

describe('pdfExtractor (Phase 6 §9)', () => {
  it('extracts per-page native text with page numbers', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'multi-page-tender.pdf'))
    const result = await pdfExtractor.extract(bytes)
    expect(result.pages).toHaveLength(5)
    expect(result.pages[0]!.pageNumber).toBe(1)
    expect(result.pages[0]!.extractionMethod).toBe('NATIVE_TEXT')
    expect(result.pages.map((p) => p.text).join(' ')).toContain('SCOPE OF WORK')
    expect(result.ocrRequired).toBe(false)
  })

  it('flags an image-only (scanned) PDF as requiring OCR, never fabricating text', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'scanned-page.pdf'))
    const result = await pdfExtractor.extract(bytes)
    expect(result.ocrRequired).toBe(true)
    expect(result.pages[0]!.text.trim()).toBe('')
  })

  it('throws on a malformed PDF rather than returning a fake empty success', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'malformed.pdf'))
    await expect(pdfExtractor.extract(bytes)).rejects.toThrow()
  })
})
