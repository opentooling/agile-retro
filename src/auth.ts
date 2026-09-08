import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Keycloak from "next-auth/providers/keycloak"
import type { Provider } from "next-auth/providers"
import { claimsFromIdToken, groupsClaimName, identityFromClaims } from "@/lib/authz"

const providers: Provider[] = []

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }))
}

if (process.env.AUTH_KEYCLOAK_ID && process.env.AUTH_KEYCLOAK_SECRET && process.env.AUTH_KEYCLOAK_ISSUER) {
    providers.push(Keycloak({
        clientId: process.env.AUTH_KEYCLOAK_ID,
        clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
        issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }))
}

export const { handlers, signIn, signOut, auth } = (NextAuth as any)({
    providers,
    callbacks: {
        async jwt({ token, account, profile }: { token: any; account: any; profile?: any }) {
            if (account) {
                console.log("JWT Callback: Account present")
                token.id_token = account.id_token
                token.provider = account.provider

                // Default role
                const roles = ['user']
                let groups: string[] = []

                // Extract identity from the Keycloak profile:
                //  - the global `admin` realm role (super-user), and
                //  - the user's groups, which drive per-team access via each
                //    team's configured member/admin groups. Groups are read from
                //    the `user_roles` claim by default (override with the
                //    GROUPS_CLAIM env var), falling back to `groups`. See
                //    src/lib/authz.ts and docs/KEYCLOAK_GROUPS.md.
                if (account.provider === 'keycloak') {
                    // Prefer the profile (ID token / userinfo as NextAuth saw it),
                    // then fall back to decoding the ID token ourselves — some
                    // deployments surface a thinner profile than the raw token.
                    const fromProfile = identityFromClaims(profile as any)
                    const fromIdToken =
                        fromProfile.groups.length === 0
                            ? identityFromClaims(claimsFromIdToken(account.id_token))
                            : { isAdminRole: false, groups: [] as string[] }

                    if (fromProfile.isAdminRole || fromIdToken.isAdminRole) {
                        roles.push('admin')
                    }
                    groups = fromProfile.groups.length > 0 ? fromProfile.groups : fromIdToken.groups

                    if (groups.length === 0) {
                        // The single most common misconfiguration: the Group
                        // Membership mapper isn't on the ID token, or its claim
                        // name doesn't match GROUPS_CLAIM. Log the claim names
                        // we did receive (names only, never values) so this is
                        // diagnosable from the pod logs.
                        console.warn(
                            `Keycloak sign-in produced no groups. Looking for claim "${groupsClaimName()}" (or "groups"). ` +
                            `profile claims: [${Object.keys((profile as any) ?? {}).join(', ')}]; ` +
                            `id_token claims: [${Object.keys(claimsFromIdToken(account.id_token) ?? {}).join(', ')}]`
                        )
                    }
                }

                token.roles = roles
                token.groups = groups
            } else {
                console.log("JWT Callback: No account (subsequent call)")
            }
            // console.log("Token state:", { hasIdToken: !!token.id_token, provider: token.provider })
            return token
        },
        async session({ session, token }: { session: any; token: any }) {
            session.id_token = token.id_token
            session.provider = token.provider
            session.roles = token.roles || ['user'] // Fallback to user if not set
            session.groups = token.groups || []
            return session
        },
    },
    secret: process.env.AUTH_SECRET,
})

export const providerMap = providers.map((provider) => {
    if (typeof provider === "function") {
        const providerData = provider()
        return { id: providerData.id, name: providerData.name }
    } else {
        return { id: provider.id, name: provider.name }
    }
})
