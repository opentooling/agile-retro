'use client'

import { SessionProvider } from "next-auth/react"
import { Sidebar } from "./Sidebar"
import { usePathname } from "next/navigation"

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

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        {!isLoginPage && (
             <Sidebar user={session?.user} keycloakIssuer={keycloakIssuer} keycloakClientId={keycloakClientId} appName={appName} />
        )}
        {/* min-w-0: a flex item won't shrink below its content's min width by
            default, so one over-wide element made the whole page scroll
            sideways and pushed right-aligned controls off-screen. */}
        <div className="min-w-0 flex-1 bg-background">
          {children}
        </div>
      </div>
    </SessionProvider>
  )
}
