import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectFileType } from '../fileType.js'

const fixturesDir = path.resolve(__dirname, '../../../../../../tests/fixtures/documents')

describe('detectFileType (Phase 6 §5 — magic bytes, never trust the extension alone)', () => {
  it('detects a real PDF from its magic bytes regardless of filename', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'normal-text.pdf'))
    const result = await detectFileType(bytes, 'renamed.txt')
    expect(result.kind).toBe('PDF')
    expect(result.detectedFromContent).toBe(true)
  })

  it('detects a real DOCX (zip + OOXML signature) even with a misleading extension', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'terms-of-reference.docx'))
    const result = await detectFileType(bytes, 'not-a-docx.pdf')
    expect(result.kind).toBe('DOCX')
  })

  it('detects a real XLSX', async () => {
    const bytes = readFileSync(path.join(fixturesDir, 'pricing-schedule.xlsx'))
    const result = await detectFileType(bytes, 'pricing-schedule.xlsx')
    expect(result.kind).toBe('XLSX')
  })

  it('detects a real PDF magic header even in a structurally malformed file — extension is never what decides this', async () => {
    // "%PDF-" is a genuine magic byte signature, so content-based
    // detection correctly reports PDF here; whether the file is
    // actually well-formed enough to extract is a separate concern
    // handled at extraction time (pdfExtractor.test.ts — throws
    // INVALID for this exact fixture rather than a fake empty result).
    const bytes = readFileSync(path.join(fixturesDir, 'malformed.pdf'))
    const result = await detectFileType(bytes, 'malformed.pdf')
    expect(result.kind).toBe('PDF')
  })

  it('does not trust a ".pdf" extension when the content has no PDF (or any other) magic bytes and looks like plain text', async () => {
    const bytes = Buffer.from('This file is actually just plain text, not a PDF at all.')
    const result = await detectFileType(bytes, 'totally-not-a.pdf')
    expect(result.kind).toBe('TXT')
  })

  it('detects HTML from content structure, not extension', async () => {
    const bytes = Buffer.from('<!doctype html><html><body><h1>Tender</h1></body></html>')
    const result = await detectFileType(bytes, 'weird-name.dat')
    expect(result.kind).toBe('HTML')
    expect(result.detectedFromContent).toBe(true)
  })

  it('detects plain text from content, not extension', async () => {
    const bytes = Buffer.from('Just plain text content for a tender notice.')
    const result = await detectFileType(bytes, 'notice')
    expect(result.kind).toBe('TXT')
  })

  it('never treats binary garbage with a NUL byte as plain text', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00])
    const result = await detectFileType(bytes, 'data.bin')
    expect(result.kind).toBe('UNKNOWN')
  })
})
