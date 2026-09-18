import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AsyncBoundary } from './AsyncBoundary.js'
import type { AsyncState } from '@tender-os/types'

describe('AsyncBoundary', () => {
  it('renders the loading state', () => {
    const state: AsyncState<string[]> = { status: 'loading' }
    render(<AsyncBoundary state={state}>{() => <div>content</div>}</AsyncBoundary>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders the error state with the real message, not a generic one', () => {
    const state: AsyncState<string[]> = { status: 'error', error: 'network unreachable' }
    render(<AsyncBoundary state={state}>{() => <div>content</div>}</AsyncBoundary>)
    expect(screen.getByText('network unreachable')).toBeInTheDocument()
  })

  it('renders the empty state when isEmpty matches', () => {
    const state: AsyncState<string[]> = { status: 'success', data: [] }
    render(
      <AsyncBoundary state={state} isEmpty={(data) => data.length === 0} emptyTitle="No items">
        {() => <div>content</div>}
      </AsyncBoundary>,
    )
    expect(screen.getByText('No items')).toBeInTheDocument()
  })

  it('renders children on success with data', () => {
    const state: AsyncState<string[]> = { status: 'success', data: ['a'] }
    render(
      <AsyncBoundary state={state} isEmpty={(data) => data.length === 0}>
        {(data) => <div>{data.join(',')}</div>}
      </AsyncBoundary>,
    )
    expect(screen.getByText('a')).toBeInTheDocument()
  })
})
