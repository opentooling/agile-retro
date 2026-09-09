'use client'

import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { LayoutDashboard, History, Filter, Tag, LogOut, LogIn, ChevronLeft, ChevronRight, Users, CheckSquare, HelpCircle, Coins, TrendingUp, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { getPopularTags } from "@/app/actions"
import { useSession, signIn, signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface SidebarProps {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  keycloakIssuer?: string
  keycloakClientId?: string
  /** Product name for this deployment (see lib/branding.ts). */
  appName: string
}

interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
  isActive: boolean
  isCollapsed: boolean
}

function NavItem({ href, icon: Icon, label, isActive, isCollapsed }: NavItemProps) {
  if (isCollapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={isActive ? 'secondary' : 'ghost'} size="icon" className="w-full" asChild>
              <Link href={href}>
                <Icon className="w-5 h-5" />
                <span className="sr-only">{label}</span>
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <Button variant={isActive ? 'secondary' : 'ghost'} className="justify-start w-full" asChild>
      <Link href={href}>
        <Icon className="w-5 h-5 mr-2" />
        {label}
      </Link>
    </Button>
  )
}


export function Sidebar({ user, keycloakIssuer, keycloakClientId, appName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [popularTags, setPopularTags] = useState<{tag: string, count: number}[]>([])
  const { data: session } = useSession()
  // On a board the rail is pure overhead: its Filters block is already hidden
  // there, so it contributes a nav strip and a duplicate ModeToggle while taking
  // 256px from the screen that needs it most. Start collapsed there.
  const isBoardRoute = pathname.startsWith('/retro/')
  const [isCollapsed, setIsCollapsed] = useState(isBoardRoute)
  // Re-apply the default when crossing into or out of a board, without
  // overriding a deliberate toggle while staying on the same kind of route.
  const collapseRoute = useRef(isBoardRoute)
  useEffect(() => {
    if (collapseRoute.current !== isBoardRoute) {
      collapseRoute.current = isBoardRoute
      setIsCollapsed(isBoardRoute)
    }
  }, [isBoardRoute])

  useEffect(() => {
    getPopularTags().then(setPopularTags)

    const handleRetroCreated = () => {
        getPopularTags().then(setPopularTags)
    }

    window.addEventListener('retro-created', handleRetroCreated)
    return () => {
        window.removeEventListener('retro-created', handleRetroCreated)
    }
  }, [])

  // Carry the active filters along when navigating between screens, so they
  // aren't cleared just because the user switched pages. Only cross-cutting
  // filter keys are preserved (page-specific ones like status/myBoards are not).
  const preservedFilters = (() => {
    const preserved = new URLSearchParams()
    for (const key of ['teamId', 'creator', 'tag', 'assignee']) {
      const value = searchParams.get(key)
      if (value) preserved.set(key, value)
    }
    const qs = preserved.toString()
    return qs ? `?${qs}` : ''
  })()

  const handleFilterChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    if (value) {
      if (key === 'tag' && params.get('tag') === value) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleSignOut = async () => {
    const customSession = session as any
    if (customSession?.provider === 'keycloak' && keycloakIssuer) {
        // RP-initiated logout: end the Keycloak SSO session too, not just ours.
        // Keycloak only honours post_logout_redirect_uri when the request also
        // identifies the client, via id_token_hint or (failing that) client_id.
        const params = new URLSearchParams({ post_logout_redirect_uri: window.location.origin })
        if (customSession.id_token) params.set('id_token_hint', customSession.id_token)
        else if (keycloakClientId) params.set('client_id', keycloakClientId)
        const logoutUrl = `${keycloakIssuer.replace(/\/$/, '')}/protocol/openid-connect/logout?${params}`

        // Clear our session, then navigate to Keycloak ourselves. We can't hand
        // this URL to signOut({ redirectTo }): Auth.js's default `redirect`
        // callback discards any off-origin URL and returns the app's base URL
        // instead, so the browser never reaches Keycloak and its SSO session
        // survives — the next sign-in then silently re-authenticates with no
        // prompt, which looks like logout not working at all.
        await signOut({ redirect: false })
        window.location.href = logoutUrl
    } else {
        await signOut()
    }
  }

  return (
    <div className={cn(
      "border-r bg-muted/20 h-screen sticky top-0 flex flex-col transition-all duration-300",
      isCollapsed ? "w-16 p-2" : "w-64 p-6"
    )}>
      <div className={cn("flex mb-4", isCollapsed ? "justify-center" : "items-center justify-between")}>
        {!isCollapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <Coins className="w-6 h-6 text-primary shrink-0" />
            <span className="text-lg font-bold tracking-tight truncate">{appName}</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(!isCollapsed)}>
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto">
        <div>
            <nav className="flex flex-col gap-1">
            <NavItem href={`/${preservedFilters}`} icon={LayoutDashboard} label="Dashboard" isActive={pathname === "/"} isCollapsed={isCollapsed} />
            <NavItem href={`/teams${preservedFilters}`} icon={Users} label="Teams" isActive={pathname === "/teams"} isCollapsed={isCollapsed} />
            <NavItem href={`/actions${preservedFilters}`} icon={CheckSquare} label="Actions" isActive={pathname === "/actions"} isCollapsed={isCollapsed} />
            <NavItem href={`/history${preservedFilters}`} icon={History} label="History" isActive={pathname === "/history"} isCollapsed={isCollapsed} />
            <NavItem href="/insights" icon={TrendingUp} label="Insights" isActive={pathname === "/insights"} isCollapsed={isCollapsed} />
            <NavItem href="/help" icon={HelpCircle} label="Help" isActive={pathname === "/help"} isCollapsed={isCollapsed} />
          </nav>
        </div>

        {!isCollapsed && !pathname.startsWith('/retro/') && (
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Filter className="w-3.5 h-3.5" />
              Filters
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Team</Label>
                <Input 
                  placeholder="Filter by team..." 
                  value={searchParams.get('teamId') || ''}
                  onChange={(e) => handleFilterChange('teamId', e.target.value)}
                />
              </div>
              {pathname !== '/teams' && (
                <>
                  <div className="space-y-2">
                    <Label>Creator</Label>
                    <Input 
                      placeholder="Filter by creator..." 
                      defaultValue={searchParams.get('creator') || ''}
                      onChange={(e) => handleFilterChange('creator', e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <Input 
                      placeholder="Filter by tag..." 
                      value={searchParams.get('tag') || ''}
                      onChange={(e) => handleFilterChange('tag', e.target.value)}
                    />
                  </div>
                  
                  {popularTags.length > 0 && (
                    <div className="space-y-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Tag className="w-3 h-3" />
                        Popular tags
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {popularTags.map(({ tag, count }) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => handleFilterChange('tag', tag)}
                            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-pressed={searchParams.get('tag') === tag}
                          >
                            <Badge
                              variant={searchParams.get('tag') === tag ? "default" : "secondary"}
                              className="cursor-pointer hover:opacity-80"
                            >
                              {tag} ({count})
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-3 mt-auto">
        {user ? (
          <div>
            <div className={cn("flex items-center mb-3", isCollapsed ? "justify-center flex-col gap-2" : "justify-between")}>
                {!isCollapsed && (
                  <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-amber-600 flex items-center justify-center text-white font-bold shrink-0">
                          {user?.name?.[0] || 'U'}
                      </div>
                      <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{user?.name || 'Guest'}</span>
                          <span className="text-xs text-muted-foreground truncate">{user?.email || 'No email'}</span>
                      </div>
                  </div>
                )}
                <ModeToggle />
            </div>
            
            {isCollapsed ? (
               <TooltipProvider>
               <Tooltip>
                 <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="w-full" onClick={handleSignOut}>
                      <LogOut className="w-4 h-4" />
                    </Button>
                 </TooltipTrigger>
                 <TooltipContent side="right">Sign Out</TooltipContent>
               </Tooltip>
             </TooltipProvider>
            ) : (
              <Button variant="outline" className="w-full justify-start gap-2" onClick={handleSignOut}>
                <LogOut className="w-4 h-4" />
                Sign Out
              </Button>
            )}
          </div>
        ) : (
          isCollapsed ? (
             <TooltipProvider>
             <Tooltip>
               <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-full" onClick={() => signIn("google")}>
                    <LogIn className="w-4 h-4" />
                  </Button>
               </TooltipTrigger>
               <TooltipContent side="right">Sign In</TooltipContent>
             </Tooltip>
           </TooltipProvider>
          ) : (
            <Button className="w-full gap-2" onClick={() => signIn("google")}>
              <LogIn className="w-4 h-4" />
              Sign In with Google
            </Button>
          )
        )}
      </div>
    </div>
  )
}
