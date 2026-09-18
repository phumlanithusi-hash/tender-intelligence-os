import type { ExtractedPage } from '../extractors/types.js'
import type { OcrEngine } from './types.js'
import { rasterisePdfPage } from './pdfRasteriser.js'
import { logger } from '../../logger.js'

export interface OcrRunResult {
  pages: ExtractedPage[]
  failedPages: number[]
}

/**
 * Runs OCR page-by-page (Phase 6 §11: "support page-level
 * processing, confidence where available, retry, failure handling").
 * `sourceBytes` is the ORIGINAL document bytes (PDF or raw image);
 * for a PDF, each page is rasterised first since the OCR engine only
 * understands images. One page's OCR failure does not abort the
 * others — it is recorded in `failedPages` so the pipeline can mark
 * OCR_FAILED overall while still preserving whatever pages did
 * succeed (never silently drops the whole document to a blank
 * result).
 */
export async function runOcr(
  engine: OcrEngine,
  sourceBytes: Buffer,
  pageNumbers: number[],
  isPdf: boolean,
  maxRetriesPerPage = 1,
): Promise<OcrRunResult> {
  const pages: ExtractedPage[] = []
  const failedPages: number[] = []

  for (const pageNumber of pageNumbers) {
    let lastError: unknown
    let succeeded = false

    for (let attempt = 0; attempt <= maxRetriesPerPage && !succeeded; attempt += 1) {
      try {
        const imageBytes = isPdf ? await rasterisePdfPage(sourceBytes, pageNumber) : sourceBytes
        const result = await engine.recognizeImage(imageBytes)
        pages.push({
          pageNumber,
          text: result.text,
          extractionMethod: 'OCR',
          confidence: result.confidence,
        })
        succeeded = true
      } catch (error) {
        lastError = error
        logger.warn(
          { pageNumber, attempt, error: error instanceof Error ? error.message : String(error) },
          'OCR attempt failed',
        )
      }
    }

    if (!succeeded) {
      failedPages.push(pageNumber)
      logger.error(
        { pageNumber, error: lastError instanceof Error ? lastError.message : String(lastError) },
        'OCR failed for page after retries',
      )
    }
  }

  return { pages, failedPages }
}
