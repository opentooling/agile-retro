import { databaseUrl } from '../../db/database-url.cjs'

describe('databaseUrl', () => {
  it('uses DATABASE_URL as it is when set, whatever else is', () => {
    expect(databaseUrl({ DATABASE_URL: 'file:./dev.db', PGHOST: 'db' })).toBe('file:./dev.db')
  })

  it('builds a postgres:// URL from the PG* variables', () => {
    expect(databaseUrl({ PGHOST: 'db', PGPORT: '5432', PGUSER: 'agile', PGPASSWORD: 'pw', PGDATABASE: 'agile_retro' }))
      .toBe('postgres://agile:pw@db:5432/agile_retro')
  })

  it('percent-encodes a password that would otherwise end the userinfo', () => {
    const url = databaseUrl({ PGHOST: 'db', PGUSER: 'agile', PGPASSWORD: 'p@ss:w/rd#1', PGDATABASE: 'agile_retro' })!
    expect(url).toBe('postgres://agile:p%40ss%3Aw%2Frd%231@db/agile_retro')
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss:w/rd#1')
  })

  it('leaves out what is not set', () => {
    expect(databaseUrl({ PGHOST: 'db' })).toBe('postgres://db')
    expect(databaseUrl({ PGHOST: 'db', PGUSER: 'agile' })).toBe('postgres://agile@db')
  })

  it('is undefined with neither DATABASE_URL nor PGHOST', () => {
    expect(databaseUrl({ PGUSER: 'agile', PGPASSWORD: 'pw' })).toBeUndefined()
  })
})
