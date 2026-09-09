import { branding, DEFAULT_BRANDING } from './branding'

const ENV = ['APP_NAME', 'APP_TAGLINE', 'APP_DESCRIPTION'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]! } })

describe('branding', () => {
  it('falls back to a vendor-neutral default', () => {
    expect(branding()).toEqual(DEFAULT_BRANDING)
    expect(JSON.stringify(branding())).not.toMatch(/LME|London Metal/i)
  })

  it('takes the name from the environment', () => {
    process.env.APP_NAME = 'Metals Retro'
    expect(branding().name).toBe('Metals Retro')
  })

  it('derives a description from the name when none is given', () => {
    // Otherwise a renamed deployment would describe itself as something else.
    process.env.APP_NAME = 'Metals Retro'
    expect(branding().description).toBe('Run and track team retrospectives for Metals Retro.')
  })

  it('lets each field be set independently', () => {
    process.env.APP_NAME = 'Metals Retro'
    process.env.APP_TAGLINE = 'Sign in with your corporate account'
    process.env.APP_DESCRIPTION = 'Custom description'
    expect(branding()).toEqual({
      name: 'Metals Retro',
      tagline: 'Sign in with your corporate account',
      description: 'Custom description',
    })
  })

  it('treats blank or whitespace-only values as unset', () => {
    process.env.APP_NAME = '   '
    process.env.APP_TAGLINE = ''
    expect(branding().name).toBe(DEFAULT_BRANDING.name)
    expect(branding().tagline).toBe(DEFAULT_BRANDING.tagline)
  })
})
