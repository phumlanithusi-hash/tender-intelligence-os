import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertZipNotABomb } from '../zipGuard.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../tests/fixtures/documents')

describe('assertZipNotABomb (Phase 6 §33 — decompression bomb defence)', () => {
  it('accepts a normal, small DOCX', () => {
    const bytes = readFileSync(path.join(fixturesDir, 'terms-of-reference.docx'))
    expect(() => assertZipNotABomb(bytes)).not.toThrow()
  })

  it('accepts a normal, small XLSX', () => {
    const bytes = readFileSync(path.join(fixturesDir, 'pricing-schedule.xlsx'))
    expect(() => assertZipNotABomb(bytes)).not.toThrow()
  })

  it('rejects an archive whose declared uncompressed size exceeds the limit', () => {
    const bytes = readFileSync(path.join(fixturesDir, 'terms-of-reference.docx'))
    expect(() => assertZipNotABomb(bytes, 100)).toThrow(/decompression bomb/i)
  })

  it('does nothing for a non-zip buffer (leaves rejection to the real parser)', () => {
    expect(() => assertZipNotABomb(Buffer.from('not a zip file'))).not.toThrow()
  })
})
