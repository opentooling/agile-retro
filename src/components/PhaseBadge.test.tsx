import { render, screen } from '@testing-library/react'
import { PhaseBadge } from './PhaseBadge'

describe('PhaseBadge', () => {
  it('shows all five phases distinctly, not an open/closed binary', () => {
    // The dashboard used to collapse five phases into two states, so you
    // couldn't tell a board waiting for votes from one mid-discussion.
    const seen = ['INPUT', 'VOTING', 'REVIEW', 'ACTIONS', 'CLOSED'].map((status) => {
      const { container, unmount } = render(<PhaseBadge status={status} />)
      const html = container.innerHTML
      unmount()
      return html
    })
    expect(new Set(seen).size).toBe(5)
  })

  it('reads as a word, not a database enum', () => {
    render(<PhaseBadge status="VOTING" />)
    expect(screen.getByText('Voting')).toBeInTheDocument()
    expect(screen.queryByText('VOTING')).toBeNull()
  })

  it('carries a dark-mode variant for every phase', () => {
    // The old dashboard pills were light-mode only and glared in dark mode.
    for (const status of ['INPUT', 'VOTING', 'REVIEW', 'ACTIONS', 'CLOSED']) {
      const { container, unmount } = render(<PhaseBadge status={status} />)
      expect(container.firstElementChild!.className).toMatch(/dark:/)
      unmount()
    }
  })

  it('falls back to the raw status rather than rendering nothing', () => {
    render(<PhaseBadge status="ARCHIVED" />)
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })
})
