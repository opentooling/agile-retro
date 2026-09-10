import { render, screen } from '@testing-library/react'
import { TeamPicker } from './TeamPicker'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return MockLink
})
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }))

describe('TeamPicker', () => {
  it('does not use the app-wide `teamId` filter for selection', () => {
    // The sidebar preserves `teamId` across pages as a team-name filter, so a
    // team id in it silently empties Dashboard, History, Actions and Teams.
    render(<TeamPicker teams={teams(3)} selectedId="t0" basePath="/insights" />)
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/insights\?team=/)
      expect(link.getAttribute('href')).not.toMatch(/teamId=/)
    }
  })

  it('shows every team as a chip when there are few', () => {
    render(<TeamPicker teams={teams(4)} selectedId="t1" basePath="/insights" />)
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('marks the selected chip for assistive tech, not just visually', () => {
    render(<TeamPicker teams={teams(3)} selectedId="t2" basePath="/insights" />)
    expect(screen.getByRole('link', { name: /Team 2/ })).toHaveAttribute('aria-current', 'page')
  })

  it('switches to a searchable control once the chips would take over the page', () => {
    // Unbounded flex-wrap chips push the figures below the fold; at this size
    // the picker has to have a constant height instead.
    render(<TeamPicker teams={teams(40)} selectedId="t5" basePath="/insights" />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('40 teams')).toBeInTheDocument()
  })

  it('names the current team on the collapsed control', () => {
    render(<TeamPicker teams={teams(40)} selectedId="t5" basePath="/insights" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Team 5')
  })

  it('prompts for a choice when nothing is selected', () => {
    render(<TeamPicker teams={teams(40)} basePath="/insights" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('Select a team')
  })

  it('keeps chips right up to the limit, and drops them one past it', () => {
    const { rerender } = render(<TeamPicker teams={teams(8)} selectedId="t0" basePath="/insights" />)
    expect(screen.queryByRole('combobox')).toBeNull()
    rerender(<TeamPicker teams={teams(9)} selectedId="t0" basePath="/insights" />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
