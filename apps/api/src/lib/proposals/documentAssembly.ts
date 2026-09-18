import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell, WidthType } from 'docx'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Phase 14 §26/§27 — internal document assembly. Reuses the Phase 6
 * DocumentStorage port for persistence (lib/documents/storage.ts);
 * this module only ever builds bytes in memory from already-approved
 * (or draft, if the caller chooses) proposal content — it never
 * fetches anything itself and never fabricates a fact not present in
 * the section/block data it is given. Output is always an INTERNAL
 * DRAFT, never a submission (spec §26 binding constraint) — nothing
 * in this module talks to a procurement portal or email transport.
 */

export interface AssemblyBlock {
  blockType: string
  heading?: string | null
  text?: string | null
  items?: string[] | null
  table?: { headers: string[]; rows: string[][] } | null
}

export interface AssemblySection {
  title: string
  sectionType: string
  status: string
  blocks: AssemblyBlock[]
}

export interface AssemblyMetadata {
  tenderNumber: string | null
  tenderTitle: string
  organisation: string
  bidProjectName: string
  proposalVersion: number
  generatedDate: string
  proposalStatus: string
}

export interface AssemblyInput {
  metadata: AssemblyMetadata
  sections: AssemblySection[]
}

function blockToText(block: AssemblyBlock): string[] {
  const lines: string[] = []
  if (block.heading) lines.push(block.heading)
  if (block.text) lines.push(block.text)
  if (block.items) lines.push(...block.items.map((i) => `• ${i}`))
  return lines
}

/** Builds a .docx buffer preserving section hierarchy, headings, paragraphs, lists, tables and metadata (Phase 14 §26/§27). Deterministic and pure (no I/O). */
export async function assembleProposalDocx(input: AssemblyInput): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []

  children.push(new Paragraph({ text: input.metadata.tenderTitle, heading: HeadingLevel.TITLE }))
  children.push(new Paragraph({ text: `Tender Number: ${input.metadata.tenderNumber ?? 'N/A'}` }))
  children.push(new Paragraph({ text: `Organisation: ${input.metadata.organisation}` }))
  children.push(new Paragraph({ text: `Bid Project: ${input.metadata.bidProjectName}` }))
  children.push(new Paragraph({ text: `Proposal Version: ${input.metadata.proposalVersion}` }))
  children.push(new Paragraph({ text: `Generated: ${input.metadata.generatedDate}` }))
  children.push(new Paragraph({ text: `Status: ${input.metadata.proposalStatus} (INTERNAL DRAFT — NOT A SUBMISSION)` }))

  for (const section of input.sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }))
    if (section.blocks.length === 0) {
      children.push(new Paragraph({ text: '[No content generated for this section yet.]' }))
      continue
    }
    for (const block of section.blocks) {
      if (block.blockType === 'TABLE' && block.table) {
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [block.table.headers, ...block.table.rows].map(
            (row) =>
              new TableRow({
                children: row.map((cell) => new TableCell({ children: [new Paragraph({ text: cell })] })),
              }),
          ),
        })
        children.push(table)
        continue
      }
      if (block.blockType === 'HEADING' && block.heading) {
        children.push(new Paragraph({ text: block.heading, heading: HeadingLevel.HEADING_2 }))
        continue
      }
      for (const line of blockToText(block)) {
        children.push(new Paragraph({ children: [new TextRun(line)] }))
      }
    }
  }

  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}

/** Builds a simple internal PDF preserving section headings, paragraphs and metadata (Phase 14 §26/§27). Known limitation (Phase 14 §48): table layout renders as plain rows of text — a full grid-drawing PDF table layout is out of scope for this phase. */
export async function assembleProposalPdf(input: AssemblyInput): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 50
  const maxWidth = pageWidth - margin * 2

  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  function wrapText(text: string, size: number, useFont = font): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (useFont.widthOfTextAtSize(candidate, size) > maxWidth) {
        if (current) lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
    return lines.length > 0 ? lines : ['']
  }

  function ensureSpace(lineHeight: number) {
    if (y - lineHeight < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
  }

  function writeLine(text: string, size: number, useFont = font) {
    for (const line of wrapText(text, size, useFont)) {
      ensureSpace(size + 4)
      page.drawText(line, { x: margin, y, size, font: useFont, color: rgb(0, 0, 0) })
      y -= size + 4
    }
  }

  writeLine(input.metadata.tenderTitle, 18, boldFont)
  writeLine(`Tender Number: ${input.metadata.tenderNumber ?? 'N/A'}`, 10)
  writeLine(`Organisation: ${input.metadata.organisation}`, 10)
  writeLine(`Bid Project: ${input.metadata.bidProjectName}`, 10)
  writeLine(`Proposal Version: ${input.metadata.proposalVersion}`, 10)
  writeLine(`Generated: ${input.metadata.generatedDate}`, 10)
  writeLine(`Status: ${input.metadata.proposalStatus} (INTERNAL DRAFT — NOT A SUBMISSION)`, 10)
  y -= 10

  for (const section of input.sections) {
    ensureSpace(20)
    writeLine(section.title, 14, boldFont)
    if (section.blocks.length === 0) {
      writeLine('[No content generated for this section yet.]', 10)
      continue
    }
    for (const block of section.blocks) {
      if (block.blockType === 'TABLE' && block.table) {
        writeLine(block.table.headers.join(' | '), 9, boldFont)
        for (const row of block.table.rows) writeLine(row.join(' | '), 9)
        continue
      }
      for (const line of blockToText(block)) writeLine(line, 10)
    }
    y -= 6
  }

  return Buffer.from(await pdf.save())
}
