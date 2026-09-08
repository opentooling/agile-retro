/**
 * Diagnose why the app isn't seeing a user's Keycloak groups.
 *
 * Answers, in order, the questions that actually determine whether group-based
 * access can work:
 *
 *   1. Is the app's Keycloak config resolvable and is the issuer reachable?
 *   2. Does the client have a Group Membership mapper, and is it on the
 *      **ID token** under the claim name the app looks for (GROUPS_CLAIM)?
 *   3. Is the user actually a member of any groups in Keycloak?
 *   4. What claims would Keycloak really mint in this client's ID token for
 *      that user? (Keycloak's own scope evaluation — the ground truth.)
 *
 * Usage:
 *   npm run diag:keycloak                  # config, issuer, mapper checks
 *   npm run diag:keycloak -- <username>    # …plus that user's groups + example ID token
 *   npm run diag:keycloak -- --token <jwt> # just decode a token you already have
 *
 * Steps 2-4 need a service account (KEYCLOAK_ADMIN_CLIENT_ID/SECRET, falling
 * back to AUTH_KEYCLOAK_ID/SECRET) with the realm-management roles
 * `view-clients` and `view-users`. Without it the script still runs steps 0-1
 * and tells you what it couldn't check. It only ever reads; it changes nothing.
 */
import { claimsFromIdToken, groupsClaimName, parseGroupsClaim } from '../src/lib/authz'

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const info = (m: string) => console.log(`    ${m}`)
const heading = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`)

/** Things later steps need; collected as we go so the verdict can explain gaps. */
const notes: string[] = []

function realmFromIssuer(issuer: string): { base: string; realm: string } | null {
    const m = issuer.replace(/\/$/, '').match(/^(.*)\/realms\/([^/]+)$/)
    return m ? { base: m[1], realm: m[2] } : null
}

async function adminGet<T>(url: string, token: string): Promise<T | { __error: string }> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { __error: `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}` }
    }
    return (await res.json()) as T
}

const isError = <T,>(v: T | { __error: string }): v is { __error: string } =>
    !!v && typeof v === 'object' && '__error' in (v as object)

/** Report on a decoded token payload: does it carry the claim the app wants? */
function reportClaims(label: string, claims: Record<string, any> | null): boolean {
    const wanted = groupsClaimName()
    if (!claims) {
        bad(`${label}: could not decode`)
        return false
    }
    info(`${label} claims: ${Object.keys(claims).sort().join(', ')}`)
    const raw = claims[wanted] ?? claims.groups
    const groups = parseGroupsClaim(raw)
    if (groups.length > 0) {
        ok(`${label} carries ${groups.length} group(s) under "${wanted in claims ? wanted : 'groups'}": ${groups.join(', ')}`)
        return true
    }
    bad(`${label} has no usable groups (looked for "${wanted}", then "groups")`)
    if (claims.realm_access?.roles) info(`realm roles present: ${claims.realm_access.roles.join(', ')}`)
    return false
}

async function main() {
    const args = process.argv.slice(2)

    // --- token-only mode: decode whatever the caller already has. -----------
    const tokenFlag = args.indexOf('--token')
    if (tokenFlag !== -1) {
        heading('Decoding the supplied token')
        reportClaims('token', claimsFromIdToken(args[tokenFlag + 1]) as Record<string, any> | null)
        return
    }
    const username = args.find((a) => !a.startsWith('-'))

    // --- 0. Config the app itself would use. --------------------------------
    heading('0. App configuration')
    const issuer = process.env.AUTH_KEYCLOAK_ISSUER
    const loginClientId = process.env.AUTH_KEYCLOAK_ID
    const adminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || loginClientId
    const adminSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || process.env.AUTH_KEYCLOAK_SECRET

    if (issuer) ok(`AUTH_KEYCLOAK_ISSUER = ${issuer}`)
    else bad('AUTH_KEYCLOAK_ISSUER is not set')
    if (loginClientId) ok(`AUTH_KEYCLOAK_ID = ${loginClientId}`)
    else bad('AUTH_KEYCLOAK_ID is not set')
    ok(`GROUPS_CLAIM = ${groupsClaimName()}${process.env.GROUPS_CLAIM ? '' : '  (default)'}`)
    info(`ADMIN_GROUPS = ${process.env.ADMIN_GROUPS || '(unset)'}`)
    if (!issuer || !loginClientId) {
        bad('Cannot continue without the issuer and client id.')
        process.exit(1)
    }
    const parsed = realmFromIssuer(issuer)
    if (!parsed) {
        bad(`Issuer doesn't look like ".../realms/<realm>" — the app can't derive the admin API base from it either.`)
        process.exit(1)
    }
    const { base, realm } = parsed
    info(`realm = ${realm}`)

    // --- 1. Is the issuer reachable and correct? ----------------------------
    heading('1. Issuer reachability')
    let discovery: any = null
    try {
        const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)
        if (res.ok) {
            discovery = await res.json()
            ok(`Discovery document fetched (issuer echoes as ${discovery.issuer})`)
            if (discovery.issuer?.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
                warn('Keycloak echoes a different issuer than configured — Auth.js will reject tokens on this mismatch.')
            }
        } else {
            bad(`Discovery returned HTTP ${res.status}. Check the issuer URL and network policy from this pod.`)
        }
    } catch (e) {
        bad(`Could not reach the issuer: ${(e as Error).message}`)
        info('If you are running this outside the cluster, the issuer may only resolve from inside it.')
    }

    // --- 2. Service-account token (gates everything below). -----------------
    heading('2. Admin API access')
    if (!adminSecret) {
        warn('No client secret available — skipping steps 2-4.')
        notes.push('Set KEYCLOAK_ADMIN_CLIENT_ID/SECRET (service account with view-clients + view-users) to check mappers and evaluate tokens.')
        return verdict(username)
    }
    let saToken = ''
    try {
        const res = await fetch(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: adminClientId!,
                client_secret: adminSecret,
            }),
        })
        if (!res.ok) {
            bad(`client_credentials failed for "${adminClientId}": HTTP ${res.status}. Is "Service accounts enabled" on that client?`)
            notes.push('Steps 3-4 need a working service account.')
            return verdict(username)
        }
        saToken = (await res.json()).access_token
        ok(`Service-account token obtained for client "${adminClientId}"`)
    } catch (e) {
        bad(`Token request failed: ${(e as Error).message}`)
        return verdict(username)
    }

    // --- 3. Is the Group Membership mapper on the ID token? -----------------
    heading('3. Group Membership mapper on the login client')
    const clients = await adminGet<any[]>(
        `${base}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(loginClientId)}`,
        saToken
    )
    let clientUuid = ''
    if (isError(clients)) {
        bad(`Could not list clients: ${clients.__error}`)
        notes.push('Grant the service account the realm-management role `view-clients`.')
    } else if (clients.length === 0) {
        bad(`No client with clientId "${loginClientId}" in realm "${realm}".`)
    } else {
        clientUuid = clients[0].id
        ok(`Found client "${loginClientId}"`)
        const mappers = await adminGet<any[]>(
            `${base}/admin/realms/${realm}/clients/${clientUuid}/protocol-mappers/models`,
            saToken
        )
        if (isError(mappers)) {
            bad(`Could not read protocol mappers: ${mappers.__error}`)
        } else {
            const groupMappers = mappers.filter((m) => m.protocolMapper === 'oidc-group-membership-mapper')
            if (groupMappers.length === 0) {
                bad('No Group Membership mapper on this client\'s dedicated scope.')
                info('This alone explains empty groups. Add one (docs/KEYCLOAK_GROUPS.md step 2).')
                info('Note: a mapper on a *shared* client scope would not show here — check assigned scopes too.')
            }
            for (const m of groupMappers) {
                const claim = m.config?.['claim.name']
                const inIdToken = String(m.config?.['id.token.claim']) === 'true'
                const fullPath = String(m.config?.['full.path']) === 'true'
                console.log(`  mapper "${m.name}": claim=${claim}, id_token=${inIdToken}, access_token=${m.config?.['access.token.claim']}, userinfo=${m.config?.['userinfo.token.claim']}, full.path=${fullPath}`)
                if (!inIdToken) bad(`  → "Add to ID token" is OFF. The app reads the ID token, so groups never arrive.`)
                else ok('  → on the ID token')
                if (claim !== groupsClaimName()) bad(`  → claim "${claim}" ≠ GROUPS_CLAIM "${groupsClaimName()}"${claim === 'groups' ? ' (the app falls back to "groups", so this still works)' : ''}`)
                else ok(`  → claim name matches GROUPS_CLAIM`)
            }
        }
    }

    if (!username) {
        notes.push('Pass a username (npm run diag:keycloak -- alice) to check that user\'s groups and generate a real example ID token.')
        return verdict(username)
    }

    // --- 4. Does the user have groups, and what would the ID token hold? ----
    heading(`4. User "${username}"`)
    const users = await adminGet<any[]>(
        `${base}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
        saToken
    )
    if (isError(users)) {
        bad(`Could not look up the user: ${users.__error}`)
        notes.push('Grant the service account the realm-management role `view-users`.')
        return verdict(username)
    }
    if (users.length === 0) {
        bad(`No user "${username}" in realm "${realm}".`)
        return verdict(username)
    }
    const userId = users[0].id
    ok(`Found user (id ${userId})`)

    const groups = await adminGet<any[]>(`${base}/admin/realms/${realm}/users/${userId}/groups`, saToken)
    if (isError(groups)) {
        bad(`Could not read the user's groups: ${groups.__error}`)
    } else if (groups.length === 0) {
        bad('The user is a member of NO Keycloak groups. Nothing to put in the claim.')
        info('If they should have groups via AD, check the LDAP group federation/sync mapper.')
    } else {
        ok(`Member of ${groups.length} group(s): ${groups.map((g) => g.path ?? g.name).join(', ')}`)
    }

    if (clientUuid) {
        heading('5. Example ID token Keycloak would mint for this user')
        const example = await adminGet<any>(
            `${base}/admin/realms/${realm}/clients/${clientUuid}/evaluate-scopes/generate-example-id-token?userId=${userId}`,
            saToken
        )
        if (isError(example)) {
            bad(`Could not generate the example ID token: ${example.__error}`)
            info('This is the definitive check — the Admin Console shows the same thing under')
            info(`Clients → ${loginClientId} → Client scopes → Evaluate → "Generated ID token".`)
        } else {
            reportClaims('example ID token', example)
        }
    }

    verdict(username)
}

function verdict(username?: string) {
    heading('Summary')
    console.log('  The app reads groups from the ID token only. For access to work, all of:')
    console.log(`    • a Group Membership mapper exists, with "Add to ID token" ON`)
    console.log(`    • its claim name matches GROUPS_CLAIM ("${groupsClaimName()}") or is "groups"`)
    console.log('    • the user is actually in Keycloak groups')
    console.log('    • the team\'s member/admin groups match those paths (or their last segment)')
    if (!username) console.log('\n  Re-run with a username to check the last two.')
    for (const n of notes) console.log(`\n  → ${n}`)
    console.log()
}

main().catch((e) => {
    console.error('\nDiagnostic failed:', e)
    process.exit(1)
})
