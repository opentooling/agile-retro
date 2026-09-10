import { render, screen } from '@testing-library/react'
import { Pager, pageFromParams } from './Pager'

jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  )
  MockLink.displayName = 'MockLink'
  return MockLink
})

describe('pageFromParams', () => {
  it('defaults to the first page', () => {
    expect(pageFromParams(undefined, 100, 25)).toBe(1)
  })

  it('clamps nonsense rather than producing a negative offset', () => {
    // A negative or non-numeric page would become a negative OFFSET in SQL.
    for (const bad of ['0', '-3', 'abc', '', null]) {
      expect(pageFromParams(bad, 100, 25)).toBe(1)
    }
  })

  it('clamps past the end to the last page', () => {
    expect(pageFromParams('999', 100, 25)).toBe(4)
    expect(pageFromParams('3', 100, 25)).toBe(3)
  })

  it('is page 1 when there is nothing to show', () => {
    expect(pageFromParams('5', 0, 25)).toBe(1)
  })
})

describe('Pager', () => {
  it('stays out of the way when everything fits on one page', () => {
    const { container } = render(
      <Pager page={1} pageSize={25} total={25} basePath="/history" params={{}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('says which slice you are looking at', () => {
    render(<Pager page={2} pageSize={25} total={113} basePath="/history" params={{}} />)
    expect(screen.getByText('26–50 of 113')).toBeInTheDocument()
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
  })

  it('counts the final partial page correctly', () => {
    render(<Pager page={5} pageSize={25} total={113} basePath="/history" params={{}} />)
    expect(screen.getByText('101–113 of 113')).toBeInTheDocument()
  })

  it('carries existing filters through, so paging never drops them', () => {
    // The sidebar holds cross-page filters; losing them on page 2 would
    // silently widen the result set.
    render(
      <Pager page={2} pageSize={25} total={113} basePath="/actions"
             params={{ status: 'open', teamId: 'Platform', page: '2' }} />
    )
    const next = screen.getByRole('link', { name: 'Next' })
    expect(next).toHaveAttribute('href', expect.stringContaining('status=open'))
    expect(next).toHaveAttribute('href', expect.stringContaining('teamId=Platform'))
    expect(next).toHaveAttribute('href', expect.stringContaining('page=3'))
  })

  it('omits page=1 from the first page link, keeping the canonical URL clean', () => {
    render(<Pager page={2} pageSize={25} total={113} basePath="/history" params={{}} />)
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/history')
  })

  it('offers no Previous on the first page', () => {
    render(<Pager page={1} pageSize={25} total={113} basePath="/history" params={{}} />)
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Next' })).toBeInTheDocument()
  })

  it('offers no Next on the last page', () => {
    render(<Pager page={5} pageSize={25} total={113} basePath="/history" params={{}} />)
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Previous' })).toBeInTheDocument()
  })
})
