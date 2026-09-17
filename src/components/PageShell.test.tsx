/**
 * The page shell's width variants.
 *
 * The wide value lives under a `2xl:` variant, and tailwind-merge does not
 * de-duplicate across variant prefixes. That is the whole reason width is a
 * prop and not a className override: a caller passing `max-w-3xl` would win
 * against the base class and still inherit `2xl:max-w-[1700px]`, so the Help
 * page would quietly stretch to 1700px on a large monitor while looking
 * correct everywhere the tests run.
 */
import { render } from '@testing-library/react'
import { PageShell } from './PageHeader'

const shellOf = (ui: React.ReactElement) =>
  render(ui).container.firstElementChild as HTMLElement

describe('PageShell widths', () => {
  it('keeps the reading width by default', () => {
    const el = shellOf(<PageShell>x</PageShell>)
    expect(el.className).toContain('max-w-6xl')
    expect(el.className).not.toMatch(/2xl:max-w-/)
  })

  it('lets the wide variant grow only at 2xl', () => {
    const el = shellOf(<PageShell width="wide">x</PageShell>)
    // Still the reading width below 2xl, so nothing changes on a laptop.
    expect(el.className).toContain('max-w-6xl')
    expect(el.className).toContain('2xl:max-w-[1700px]')
  })

  it('never leaks the wide cap into the prose width', () => {
    const el = shellOf(<PageShell width="prose">x</PageShell>)
    expect(el.className).toContain('max-w-3xl')
    expect(el.className).not.toMatch(/2xl:max-w-/)
    expect(el.className).not.toContain('max-w-6xl')
  })

  it('does not let a className override reintroduce the wide cap', () => {
    const el = shellOf(<PageShell className="max-w-3xl">x</PageShell>)
    expect(el.className).not.toMatch(/2xl:max-w-/)
  })
})
