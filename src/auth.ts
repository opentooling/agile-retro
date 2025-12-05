import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Keycloak from "next-auth/providers/keycloak"
import type { Provider } from "next-auth/providers"

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

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers,
    callbacks: {
        async jwt({ token, account, profile }) {
            if (account) {
                console.log("JWT Callback: Account present")
                token.id_token = account.id_token
                token.provider = account.provider

                // Default role
                const roles = ['user']

                // Extract roles from Keycloak profile
                if (account.provider === 'keycloak' && profile) {
                    // Keycloak typically puts roles in realm_access.roles or resource_access
                    // We need to cast profile to any to access these properties as they are not in the standard Profile type
                    const keycloakProfile = profile as any
                    const realmRoles = keycloakProfile.realm_access?.roles || []

                    if (realmRoles.includes('admin')) {
                        roles.push('admin')
                    }
                }

                token.roles = roles
            } else {
                console.log("JWT Callback: No account (subsequent call)")
            }
            // console.log("Token state:", { hasIdToken: !!token.id_token, provider: token.provider })
            return token
        },
        async session({ session, token }) {
            session.id_token = token.id_token
            session.provider = token.provider
            session.roles = token.roles || ['user'] // Fallback to user if not set
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
