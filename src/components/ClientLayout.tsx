'use client'

import { SessionProvider } from "next-auth/react"
import { Sidebar } from "./Sidebar"
import { usePathname } from "next/navigation"

interface ClientLayoutProps {
  children: React.ReactNode
  session: any
  keycloakIssuer?: string
}

export function ClientLayout({ children, session, keycloakIssuer }: ClientLayoutProps) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen">
        {!isLoginPage && (
             <Sidebar user={session?.user} keycloakIssuer={keycloakIssuer} />
        )}
        <div className="flex-1 bg-gray-50 dark:bg-gray-900">
          {children}
        </div>
      </div>
    </SessionProvider>
  )
}
