import { auth } from "@/auth"
import { NextResponse } from "next/server"

/**
 * Pages anyone may read before signing in. Exact paths, not prefixes, so a new
 * route can never become public by sharing a first few letters with one of
 * these. Help is here because people need to know what the app is and how
 * access works *before* they have access — it is static text built from the
 * format list and the app's name, and reads no session or data.
 */
const PUBLIC_PATHS = new Set(['/help'])

export default auth((req: any) => {
    const isLoggedIn = !!req.auth
    const isOnLoginPage = req.nextUrl.pathname.startsWith('/login')

    if (PUBLIC_PATHS.has(req.nextUrl.pathname)) return

    if (isOnLoginPage) {
        if (isLoggedIn) {
            return NextResponse.redirect(new URL('/', req.nextUrl))
        }
        return
    }

    if (!isLoggedIn) {
        return NextResponse.redirect(new URL('/login', req.nextUrl))
    }
})

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
