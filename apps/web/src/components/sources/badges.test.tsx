import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SourceHealthBadge, AdapterStateBadge, AuthorityBadge } from './badges.js'

describe('SourceHealthBadge', () => {
  it('renders a human-readable label for every health status', () => {
    render(<SourceHealthBadge status="HEALTHY" />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })
})

describe('AdapterStateBadge', () => {
  it('renders NOT_IMPLEMENTED as the plain, honest "Not connected" label (Phase 4 §5)', () => {
    render(<AdapterStateBadge state="NOT_IMPLEMENTED" />)
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('renders ACTIVE distinctly from NOT_IMPLEMENTED', () => {
    const { unmount } = render(<AdapterStateBadge state="ACTIVE" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    unmount()
    render(<AdapterStateBadge state="PAUSED" />)
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })
})

describe('AuthorityBadge', () => {
  it('gives PRIMARY a distinct label from SECONDARY/DISCOVERY (Phase 4 §21)', () => {
    const { unmount } = render(<AuthorityBadge authority="PRIMARY" />)
    expect(screen.getByText('Primary')).toBeInTheDocument()
    unmount()
    render(<AuthorityBadge authority="DISCOVERY" />)
    expect(screen.getByText('Discovery')).toBeInTheDocument()
  })
})
