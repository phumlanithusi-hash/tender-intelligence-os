import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)
let cachedAvailability: boolean | undefined

/** True when the system `pdftoppm` (poppler-utils) binary is available for rasterising a scanned PDF page to an image the OCR engine can read. */
export async function isPdfRasteriserAvailable(): Promise<boolean> {
  if (cachedAvailability !== undefined) return cachedAvailability
  try {
    await execFileAsync('pdftoppm', ['-v'], { timeout: 5000 })
    cachedAvailability = true
  } catch {
    cachedAvailability = false
  }
  return cachedAvailability
}

/**
 * Renders one page of a PDF to a PNG image (Phase 6 §10) so the OCR
 * engine — which only understands raster images — can process a
 * scanned/image-only page. Uses `pdftoppm` (poppler-utils), a mature
 * rendering-only tool with no macro/script execution surface.
 */
export async function rasterisePdfPage(pdfBytes: Buffer, pageNumber: number): Promise<Buffer> {
  if (!(await isPdfRasteriserAvailable())) {
    throw new Error('pdftoppm binary is not available in this environment')
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'tender-pdf-raster-'))
  const inputPath = path.join(dir, 'input.pdf')
  const outputPrefix = path.join(dir, 'page')
  try {
    await writeFile(inputPath, pdfBytes)
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', '200', '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', inputPath, outputPrefix],
      { timeout: 30_000 },
    )
    return await readFile(`${outputPrefix}.png`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
