import ExcelJS from 'exceljs'
import { assertZipNotABomb } from '../zipGuard.js'
import type { DocumentExtractor, ExtractedTable, ExtractionResult } from './types.js'

/**
 * XLSX extraction (Phase 6 §9/§21/§33) — used for pricing schedules,
 * SBD forms and other spreadsheet tender documents. ExcelJS parses
 * the OOXML spreadsheet as data only (never executes macros or
 * formulas — cell values are read as computed/cached values already
 * stored in the file, not re-evaluated). Each worksheet becomes one
 * logical "page" (there is no fixed pagination in a spreadsheet
 * either) so a chunk can still be cited as "Page 2 (Pricing Schedule
 * tab)". Row/column structure is preserved as a table per sheet
 * (Phase 6 §21) rather than flattened.
 */
export const xlsxExtractor: DocumentExtractor = {
  kind: 'XLSX',
  async extract(bytes: Buffer): Promise<ExtractionResult> {
    assertZipNotABomb(bytes)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)

    const pages: ExtractionResult['pages'] = []
    const tables: ExtractedTable[] = []
    const warnings: string[] = []

    workbook.worksheets.forEach((sheet, index) => {
      const pageNumber = index + 1
      const rows: string[][] = []
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = []
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cellText(cell.value))
        })
        rows.push(cells)
      })

      const text = [`Sheet: ${sheet.name}`, ...rows.map((r) => r.join('\t'))].join('\n')
      pages.push({ pageNumber, text, extractionMethod: 'STRUCTURED', confidence: null })
      if (rows.length > 0) tables.push({ pageNumber, rows })
    })

    if (pages.length === 0) warnings.push('Workbook contained no worksheets.')

    return { pages, tables, ocrRequired: false, warnings }
  },
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text
    }
    if ('result' in value) return cellText((value as { result: ExcelJS.CellValue }).result)
    if (value instanceof Date) return value.toISOString()
    return JSON.stringify(value)
  }
  return String(value)
}
