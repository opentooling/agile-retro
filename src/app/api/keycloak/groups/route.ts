/**
 * Lists Keycloak groups to power the team access-group picker.
 *
 * This requires a Keycloak **service account** (a confidential client with the
 * realm-management `query-groups` / `view-realm` roles). Configure via env:
 *
 *   KEYCLOAK_ADMIN_CLIENT_ID       (falls back to AUTH_KEYCLOAK_ID)
 *   KEYCLOAK_ADMIN_CLIENT_SECRET   (falls back to AUTH_KEYCLOAK_SECRET)
 *   AUTH_KEYCLOAK_ISSUER           (e.g. https://kc.example.com/realms/myrealm)
 *
 * When these aren't set (or the call fails), the route responds
 * `{ configured: false, groups: [] }` and the UI falls back to free-text entry.
 * The route is auth-gated because /api/* bypasses the login middleware.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/auth'

type KeycloakGroup = { path?: string; name?: string; subGroups?: KeycloakGroup[] }

function adminBaseFromIssuer(issuer: string): { adminGroupsUrl: string; tokenUrl: string } | null {
    // issuer looks like https://host[/...]/realms/<realm>
    const m = issuer.match(/^(.*)\/realms\/([^/]+)\/?$/)
    if (!m) return null
    const [, host, realm] = m
    return {
        adminGroupsUrl: `${host}/admin/realms/${realm}/groups?briefRepresentation=false`,
        tokenUrl: `${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`,
    }
}

/** Flatten Keycloak's group hierarchy into a sorted list of full paths. */
function flattenPaths(groups: KeycloakGroup[], acc: string[] = []): string[] {
    for (const g of groups) {
        if (g.path) acc.push(g.path)
        if (Array.isArray(g.subGroups) && g.subGroups.length) flattenPaths(g.subGroups, acc)
    }
    return acc
}

const NOT_CONFIGURED = { configured: false, groups: [] as string[] }

export async function GET() {
    const session = await auth()
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || process.env.AUTH_KEYCLOAK_ID
    const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || process.env.AUTH_KEYCLOAK_SECRET
    const issuer = process.env.AUTH_KEYCLOAK_ISSUER

    if (!clientId || !clientSecret || !issuer) {
        return NextResponse.json(NOT_CONFIGURED)
    }

    const endpoints = adminBaseFromIssuer(issuer)
    if (!endpoints) return NextResponse.json(NOT_CONFIGURED)

    try {
        // 1. Service-account token (client_credentials grant).
        const tokenRes = await fetch(endpoints.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
            }),
        })
        if (!tokenRes.ok) return NextResponse.json(NOT_CONFIGURED)
        const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string }
        if (!accessToken) return NextResponse.json(NOT_CONFIGURED)

        // 2. List groups (hierarchy) and flatten to full paths.
        const groupsRes = await fetch(endpoints.adminGroupsUrl, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        })
        if (!groupsRes.ok) return NextResponse.json(NOT_CONFIGURED)
        const raw = (await groupsRes.json()) as KeycloakGroup[]
        const groups = Array.from(new Set(flattenPaths(Array.isArray(raw) ? raw : []))).sort()

        return NextResponse.json({ configured: true, groups })
    } catch (err) {
        console.error('Failed to list Keycloak groups:', err)
        return NextResponse.json(NOT_CONFIGURED)
    }
}
