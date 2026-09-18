'use client'

import { SessionProvider } from "next-auth/react"
import { Sidebar } from "./Sidebar"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

interface ClientLayoutProps {
  children: React.ReactNode
  session: any
  keycloakIssuer?: string
  keycloakClientId?: string
  appName: string
}

export function ClientLayout({ children, session, keycloakIssuer, keycloakClientId, appName }: ClientLayoutProps) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'
  const isBoard = pathname.startsWith('/retro/')

  if (isLoginPage) {
    return <SessionProvider session={session}>{children}</SessionProvider>
  }

  return (
    <SessionProvider session={session}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar user={session?.user} keycloakIssuer={keycloakIssuer} keycloakClientId={keycloakClientId} appName={appName} />
        {/* min-w-0: a flex item won't shrink below its content's min width by
            default, so one over-wide element made the whole page scroll
            sideways and pushed right-aligned controls off-screen.
            On a phone the tab bar is fixed to the bottom; the page leaves room
            for it (the board has no tab bar). */}
        <main id="main" className={cn("min-w-0 flex-1 bg-background", !isBoard && "pb-20 md:pb-0")}>
          {children}
        </main>
      </div>
    </SessionProvider>
  )
}
