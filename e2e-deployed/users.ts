import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The demo users, read from the realm the local Keycloak imports — one source
 * of truth, so a user renamed or a password changed there cannot drift from
 * what the tests type.
 */
type RealmUser = {
  username: string
  firstName?: string
  lastName?: string
  email?: string
  groups?: string[]
  credentials?: { type: string; value: string }[]
}

const realm = JSON.parse(
  readFileSync(join(__dirname, '..', 'deploy', 'local', 'keycloak-realm.json'), 'utf8'),
) as { users: RealmUser[] }

export type DemoUser = { username: string; password: string; displayName: string; groups: string[] }

export function demoUser(username: 'alice' | 'bob' | 'carol' | 'dave'): DemoUser {
  const u = realm.users.find((x) => x.username === username)
  const password = u?.credentials?.find((c) => c.type === 'password')?.value
  if (!u || !password) throw new Error(`No demo user ${username} with a password in keycloak-realm.json`)
  return {
    username,
    password,
    displayName: [u.firstName, u.lastName].filter(Boolean).join(' '),
    groups: u.groups ?? [],
  }
}
