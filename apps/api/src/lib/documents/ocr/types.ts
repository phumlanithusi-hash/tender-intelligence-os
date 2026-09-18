export interface OcrPageResult {
  text: string
  /** 0-1 average word confidence, when the engine reports one. */
  confidence: number | null
}

/**
 * OCR engine interface (Phase 6 §10/§11): "Implement an OCR pipeline
 * interface with page-level provenance. If no OCR engine is available
 * in this environment, provide the interface and an explicit
 * failure/reprocessing state — do not fabricate OCR text."
 */
export interface OcrEngine {
  readonly name: string
  isAvailable(): Promise<boolean>
  recognizeImage(imageBytes: Buffer): Promise<OcrPageResult>
}

export class OcrUnavailableError extends Error {
  constructor(engineName: string) {
    super(`OCR engine "${engineName}" is not available in this environment.`)
    this.name = 'OcrUnavailableError'
  }
}
