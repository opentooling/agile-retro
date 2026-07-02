import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Keycloak from "next-auth/providers/keycloak"
import type { Provider } from "next-auth/providers"
import { parseGroupsClaim } from "@/lib/authz"

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
                //  - the user's groups (the `groups` claim), which drive per-team
                //    access via each team's configured member/admin groups. See
                //    src/lib/authz.ts and docs/KEYCLOAK_GROUPS.md.
                if (account.provider === 'keycloak' && profile) {
                    // Cast: these claims aren't in the standard Profile type.
                    const keycloakProfile = profile as any
                    const realmRoles = keycloakProfile.realm_access?.roles || []
                    if (Array.isArray(realmRoles) && realmRoles.includes('admin')) {
                        roles.push('admin')
                    }
                    groups = parseGroupsClaim(keycloakProfile.groups)
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
