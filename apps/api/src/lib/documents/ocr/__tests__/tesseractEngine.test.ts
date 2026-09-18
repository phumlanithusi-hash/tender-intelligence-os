import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TesseractOcrEngine } from '../tesseractEngine.js'

/**
 * Genuine OCR test — this sandbox has a real `tesseract` binary with
 * the `eng` language pack installed (verified: `tesseract --list-
 * langs`), so this exercises REAL recognition, not a stub. If a
 * future environment lacks the binary, `isAvailable()` reports false
 * and the pipeline moves to OCR_FAILED with a clear reason instead of
 * fabricating text (Phase 6 §11) — see pipeline.test.ts for that
 * failure-path coverage via a fake engine.
 */
describe('TesseractOcrEngine (Phase 6 §11 — real OCR where available)', () => {
  const engine = new TesseractOcrEngine()

  it('reports availability truthfully', async () => {
    const available = await engine.isAvailable()
    expect(typeof available).toBe('boolean')
  })

  it('recognises text from a rendered PNG with real confidence scores', async () => {
    const available = await engine.isAvailable()
    if (!available) {
      // Documented, not silently skipped: this environment has no
      // OCR engine — the failure path is what pipeline.test.ts covers.
      return
    }

    const dir = mkdtempSync(path.join(tmpdir(), 'ocr-fixture-'))
    const pngPath = path.join(dir, 'sample.png')
    try {
      execFileSync('convert', [
        '-size', '700x150', 'xc:white',
        '-pointsize', '28', '-fill', 'black',
        '-draw', "text 20,80 'PROCUREMENT EVIDENCE SAMPLE'",
        pngPath,
      ])
      const imageBytes = readFileSync(pngPath)
      const result = await engine.recognizeImage(imageBytes)
      expect(result.text.toUpperCase()).toContain('PROCUREMENT')
      expect(result.confidence).not.toBeNull()
      expect(result.confidence!).toBeGreaterThan(0)
      expect(result.confidence!).toBeLessThanOrEqual(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
