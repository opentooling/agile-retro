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

  it('adapts to dark mode for every phase', () => {
    // The old dashboard pills were light-mode only and glared in dark mode.
    // They now take their fill and ink from tone tokens, which carry a dark
    // value each — so the check is that no phase falls back to a fixed colour.
    for (const status of ['INPUT', 'VOTING', 'REVIEW', 'ACTIONS', 'CLOSED']) {
      const { container, unmount } = render(<PhaseBadge status={status} />)
      const className = container.firstElementChild!.className
      expect(className).toMatch(/bg-\[hsl\(var\(--tone-[a-z]+-soft\)\)\]/)
      expect(className).toMatch(/text-\[hsl\(var\(--tone-[a-z]+-ink\)\)\]/)
      unmount()
    }
  })

  it('falls back to the raw status rather than rendering nothing', () => {
    render(<PhaseBadge status="ARCHIVED" />)
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })
})
