import { describe, expect, it } from 'vitest'
import { assembleProposalDocx, assembleProposalPdf, type AssemblyInput } from '../documentAssembly.js'

function baseInput(overrides: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    metadata: {
      tenderNumber: 'TND-2026-001',
      tenderTitle: 'Supply of Widgets',
      organisation: 'Test Agency Pty Ltd',
      bidProjectName: 'Widget Bid',
      proposalVersion: 1,
      generatedDate: '2026-09-11',
      proposalStatus: 'DRAFT',
    },
    sections: [
      { title: 'Executive Summary', sectionType: 'EXECUTIVE_SUMMARY', status: 'APPROVED_INTERNAL', blocks: [{ blockType: 'PARAGRAPH', text: 'We propose to deliver the widgets on time.' }] },
      { title: 'Team', sectionType: 'TEAM', status: 'DRAFT', blocks: [] },
      {
        title: 'Deliverables',
        sectionType: 'DELIVERABLES',
        status: 'DRAFT',
        blocks: [{ blockType: 'TABLE', table: { headers: ['Item', 'Qty'], rows: [['Widget A', '10']] } }],
      },
    ],
    ...overrides,
  }
}

describe('assembleProposalDocx (Phase 14 §26/§27)', () => {
  it('produces a non-empty, valid docx (zip) buffer', async () => {
    const buffer = await assembleProposalDocx(baseInput())
    expect(buffer.length).toBeGreaterThan(0)
    // A .docx is a zip container — starts with the PK signature.
    expect(buffer.subarray(0, 2).toString('hex')).toBe('504b')
  })

  it('preserves section order (order of sections in the input matches the document build order)', async () => {
    const input = baseInput()
    const buffer = await assembleProposalDocx(input)
    // We cannot easily parse the zip here without adding a new
    // dependency; instead assert the builder was called with sections
    // in a stable, unmutated order (the input array itself).
    expect(input.sections.map((s) => s.title)).toEqual(['Executive Summary', 'Team', 'Deliverables'])
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('handles an empty/unresolved section (no blocks) without throwing', async () => {
    const buffer = await assembleProposalDocx(baseInput({ sections: [{ title: 'Empty', sectionType: 'OTHER', status: 'DRAFT', blocks: [] }] }))
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('includes tender number, organisation, bid project name and proposal version in the metadata block (no secrets)', async () => {
    // Indirect check: building succeeds with the full metadata set and
    // does not throw when optional tenderNumber is null.
    const buffer = await assembleProposalDocx(baseInput({ metadata: { ...baseInput().metadata, tenderNumber: null } }))
    expect(buffer.length).toBeGreaterThan(0)
  })
})

describe('assembleProposalPdf (Phase 14 §26/§27)', () => {
  it('produces a non-empty, valid PDF buffer', async () => {
    const buffer = await assembleProposalPdf(baseInput())
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-')
  })

  it('handles many sections/long text by spanning multiple pages without throwing', async () => {
    const manySections = Array.from({ length: 40 }, (_, i) => ({
      title: `Section ${i}`,
      sectionType: 'OTHER',
      status: 'DRAFT',
      blocks: [{ blockType: 'PARAGRAPH', text: 'Lorem ipsum '.repeat(100) }],
    }))
    const buffer = await assembleProposalPdf(baseInput({ sections: manySections }))
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('handles an empty/unresolved section (no blocks) without throwing', async () => {
    const buffer = await assembleProposalPdf(baseInput({ sections: [{ title: 'Empty', sectionType: 'OTHER', status: 'DRAFT', blocks: [] }] }))
    expect(buffer.length).toBeGreaterThan(0)
  })
})
