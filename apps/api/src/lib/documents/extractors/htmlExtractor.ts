import type { DocumentExtractor, ExtractionResult } from './types.js'

/**
 * HTML extraction (Phase 6 §9). Deliberately minimal: strips
 * `<script>`/`<style>` content, strips remaining tags, collapses
 * whitespace, and decodes the small set of named/numeric entities
 * likely to appear in tender pages copied to HTML. No DOM/JS
 * execution ever occurs — the input is treated as text to be parsed,
 * not as a page to be rendered (Phase 6 §33: untrusted content).
 */
export const htmlExtractor: DocumentExtractor = {
  kind: 'HTML',
  async extract(bytes: Buffer): Promise<ExtractionResult> {
    const html = bytes.toString('utf8')
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
    const withBreaks = withoutScripts.replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    const textOnly = withBreaks.replace(/<[^>]+>/g, ' ')
    const decoded = decodeEntities(textOnly)
    const text = decoded.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

    return {
      pages: [{ pageNumber: 1, text, extractionMethod: 'NATIVE_TEXT', confidence: null }],
      tables: [],
      ocrRequired: false,
      warnings: [],
    }
  },
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}
