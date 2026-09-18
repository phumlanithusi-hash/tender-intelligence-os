import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenderStatusBadge, OpportunityClassBadge, EvidenceTag, RequirementStatusBadge, DisqualificationRiskBadge, DecisionSignalBadge, ScoreGateStatusBadge } from './badges.js'

describe('TenderStatusBadge', () => {
  it('renders a human-readable label for an enum status', () => {
    render(<TenderStatusBadge status="CLOSING_SOON" />)
    expect(screen.getByText('CLOSING SOON')).toBeInTheDocument()
  })
})

describe('OpportunityClassBadge', () => {
  it('only renders when given an actual score class — never invents one', () => {
    render(<OpportunityClassBadge scoreClass="PRIORITY_BID" />)
    expect(screen.getByText('Priority Bid')).toBeInTheDocument()
  })

  it('falls back to the raw value for an unrecognised class rather than hiding it', () => {
    render(<OpportunityClassBadge scoreClass="SOMETHING_NEW" />)
    expect(screen.getByText('SOMETHING_NEW')).toBeInTheDocument()
  })
})

describe('EvidenceTag', () => {
  it('labels VERIFIED data as source verified', () => {
    render(<EvidenceTag status="VERIFIED" />)
    expect(screen.getByText('Source verified')).toBeInTheDocument()
  })

  it('never labels inferred/unverified/unknown data as verified (Phase 3 §22)', () => {
    for (const status of ['INFERRED', 'UNVERIFIED', 'UNKNOWN'] as const) {
      const { unmount } = render(<EvidenceTag status={status} />)
      expect(screen.queryByText('Source verified')).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('RequirementStatusBadge (Phase 9 §17/§28)', () => {
  it('renders a distinct CONFLICT label, never merged into REQUIRES_REVIEW', () => {
    render(<RequirementStatusBadge status="CONFLICT" />)
    expect(screen.getByText('CONFLICT')).toBeInTheDocument()
  })

  it('renders every other requirement/criterion status distinctly', () => {
    for (const status of ['VERIFIED', 'PROVISIONAL', 'REQUIRES_REVIEW']) {
      const { unmount } = render(<RequirementStatusBadge status={status} />)
      expect(screen.getByText(status.replace(/_/g, ' '))).toBeInTheDocument()
      unmount()
    }
  })
})

describe('DisqualificationRiskBadge (Phase 9 §12)', () => {
  it('is a severity flag only — the label never claims a qualification decision', () => {
    render(<DisqualificationRiskBadge />)
    expect(screen.getByText('Disqualification risk')).toBeInTheDocument()
    expect(screen.queryByText(/fail/i)).not.toBeInTheDocument()
  })
})

describe('DecisionSignalBadge (Phase 10 §25/§44)', () => {
  it('never renders BID/NO-BID language for any decision signal', () => {
    for (const signal of ['HIGH_PRIORITY', 'PROMISING', 'REVIEW', 'LOW_PRIORITY', 'BLOCKED', 'INSUFFICIENT_DATA']) {
      const { unmount } = render(<DecisionSignalBadge signal={signal} />)
      expect(screen.queryByText(/bid/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('renders "Not scored" rather than a fabricated signal when null', () => {
    render(<DecisionSignalBadge signal={null} />)
    expect(screen.getByText('Not scored')).toBeInTheDocument()
  })
})

describe('ScoreGateStatusBadge (Phase 10 §29/§42)', () => {
  it('distinguishes TRIGGERED, OK, and UNKNOWN — UNKNOWN is never rendered as OK', () => {
    const { unmount: u1 } = render(<ScoreGateStatusBadge status="TRIGGERED" />)
    expect(screen.getByText('TRIGGERED')).toBeInTheDocument()
    u1()
    const { unmount: u2 } = render(<ScoreGateStatusBadge status="UNKNOWN" />)
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
    u2()
    render(<ScoreGateStatusBadge status="OK" />)
    expect(screen.getByText('OK')).toBeInTheDocument()
  })
})
