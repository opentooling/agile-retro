'use client'

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import { Home, History, LogOut, LogIn, PanelLeftClose, PanelLeftOpen, Users, CheckSquare, HelpCircle, TrendingUp, Sun, Moon, Monitor, MoreHorizontal, type LucideIcon, UserRound } from "lucide-react"
import { cn } from "@/lib/utils"
import { LogoMark } from "@/components/visual/Logo"
import { Identicon } from "@/components/visual/Identicon"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

type NavEntry = { href: string; icon: LucideIcon; label: string; match: (p: string) => boolean; carryFilters: boolean }

const NAV: NavEntry[] = [
  { href: '/', icon: Home, label: 'Home', match: (p) => p === '/', carryFilters: true },
  { href: '/actions', icon: CheckSquare, label: 'Actions', match: (p) => p === '/actions', carryFilters: true },
  { href: '/history', icon: History, label: 'History', match: (p) => p === '/history', carryFilters: true },
  { href: '/insights', icon: TrendingUp, label: 'Insights', match: (p) => p === '/insights', carryFilters: false },
  { href: '/teams', icon: Users, label: 'Teams', match: (p) => p === '/teams', carryFilters: true },
  { href: '/help', icon: HelpCircle, label: 'Help', match: (p) => p === '/help', carryFilters: false },
]

/**
 * The rail: navigation and who you are, nothing else.
 *
 * Ink-dark in both themes so it recedes behind the page. It used to carry the
 * filter inputs too, which put them 256px from the list they changed and on
 * screens they did nothing to; they now sit on the pages (see ScopeBar), and the
 * rail only carries their values from page to page.
 *
 * Below 768px of window the rail becomes a bottom tab bar — except on a board,
 * which is a full-screen stage with its own way back.
 */
export function Sidebar({ user, keycloakIssuer, keycloakClientId, appName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  // On a board the rail is pure overhead: start collapsed there, so the stage
  // gets the width.
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
  const hrefFor = (entry: NavEntry) => (entry.carryFilters ? `${entry.href}${preservedFilters}` : entry.href)

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
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- logoutUrl is the identity provider's end_session endpoint, an absolute off-origin URL; router.push() cannot leave the app.
        window.location.href = logoutUrl
    } else {
        await signOut()
    }
  }

  return (
    <>
      {/* Desktop rail */}
      {/* The outer column paints the rail the full height of the page; the
          inner one sticks, so navigation stays in view while the page scrolls. */}
      <div className="hidden shrink-0 bg-rail md:block">
      <div
        className={cn(
          "sticky top-0 flex h-dvh flex-col text-rail-foreground transition-[width] duration-200 ease-out",
          isCollapsed ? "w-16" : "w-56",
        )}
      >
        <div className={cn("flex h-16 items-center gap-2.5", isCollapsed ? "justify-center px-2" : "px-4")}>
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label={`${appName} home`}>
            <LogoMark className="h-8 w-8" />
            {!isCollapsed && <span className="truncate text-[15px] font-semibold tracking-tight">{appName}</span>}
          </Link>
        </div>

        <TooltipProvider delayDuration={200}>
          <nav aria-label="Main" className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto", isCollapsed ? "px-2" : "px-3")}>
            {NAV.map((entry) => (
              <RailLink key={entry.href} entry={entry} href={hrefFor(entry)} active={entry.match(pathname)} collapsed={isCollapsed} />
            ))}
          </nav>

          <div className={cn("flex flex-col gap-1 border-t border-rail-border py-3", isCollapsed ? "items-center px-2" : "px-3")}>
            {/* Who you are, the theme, and signing out — each its own visible
                control. They used to share one menu behind your name, with
                nothing to say it was a menu, and people could not find them. */}
            {user ? (
              <>
                <ProfileLink user={user} collapsed={isCollapsed} active={pathname === '/profile'} />
                <ThemeRailButton collapsed={isCollapsed} />
                <RailButton icon={LogOut} label="Sign out" collapsed={isCollapsed} onClick={handleSignOut} />
              </>
            ) : (
              // To the sign-in page, which lists whichever providers are
              // configured — not straight to one provider, which may not exist.
              <RailButton icon={LogIn} label="Sign in" collapsed={isCollapsed} onClick={() => router.push("/login")} />
            )}
            <RailButton
              icon={isCollapsed ? PanelLeftOpen : PanelLeftClose}
              label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
              collapsed={isCollapsed}
              onClick={() => setIsCollapsed((c) => !c)}
              ariaExpanded={!isCollapsed}
            />
          </div>
        </TooltipProvider>
      </div>
      </div>

      {/* Phone: a bottom tab bar. The board has its own back link and a
          console docked where this would sit, so it is left out there. */}
      {!isBoardRoute && (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-rail-border bg-rail px-1 pb-[env(safe-area-inset-bottom)] text-rail-foreground md:hidden"
        >
          {NAV.filter((n) => n.href !== '/help').map((entry) => {
            const active = entry.match(pathname)
            const Icon = entry.icon
            return (
              <Link
                key={entry.href}
                href={hrefFor(entry)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium",
                  active ? "text-rail-active" : "text-rail-muted",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="truncate">{entry.label}</span>
              </Link>
            )
          })}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            {user ? (
              <UserMenu user={user} collapsed compact onSignOut={handleSignOut} />
            ) : (
              <button type="button" onClick={() => router.push("/login")} className="flex flex-col items-center gap-1 text-[11px] font-medium text-rail-muted">
                <LogIn className="h-5 w-5" aria-hidden /> Sign in
              </button>
            )}
          </div>
        </nav>
      )}
    </>
  )
}

function RailLink({ entry, href, active, collapsed }: { entry: NavEntry; href: string; active: boolean; collapsed: boolean }) {
  const Icon = entry.icon
  const link = (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-rail-active",
        collapsed ? "justify-center" : "px-3",
        active
          ? "bg-rail-active text-rail-active-foreground"
          : "text-rail-muted hover:bg-rail-hover hover:text-rail-foreground",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{entry.label}</span> : entry.label}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  )
}

function RailButton({
  icon: Icon, label, collapsed, onClick, ariaExpanded,
}: { icon: LucideIcon; label: string; collapsed: boolean; onClick: () => void; ariaExpanded?: boolean }) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg text-sm font-medium text-rail-muted transition-colors hover:bg-rail-hover hover:text-rail-foreground focus-visible:outline-rail-active",
        collapsed ? "w-10 justify-center" : "w-full px-3",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {!collapsed && label}
    </button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Your name and face, linking to your profile. */
function ProfileLink({ user, collapsed, active }: { user: NonNullable<SidebarProps['user']>; collapsed: boolean; active: boolean }) {
  const name = user.name || 'Guest'
  const link = (
    <Link
      href="/profile"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? `Your profile — ${name}` : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg transition-colors focus-visible:outline-rail-active",
        collapsed ? "h-10 w-10 justify-center" : "w-full px-2 py-1.5",
        active ? "bg-rail-active text-rail-active-foreground" : "hover:bg-rail-hover",
      )}
    >
      <Identicon name={name} size={collapsed ? 30 : 32} />
      {!collapsed && (
        <span className="flex min-w-0 flex-col text-left">
          <span className={cn("truncate text-sm font-medium", active ? "" : "text-rail-foreground")}>{name}</span>
          <span className={cn("truncate text-xs", active ? "opacity-80" : "text-rail-muted")}>View your profile</span>
        </span>
      )}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">Your profile</TooltipContent>
    </Tooltip>
  )
}

/**
 * Light / dark, one press. The label says what pressing it will do. "System"
 * stays available in the phone menu; on the rail a two-way switch is what
 * people reach for.
 */
function ThemeRailButton({ collapsed }: { collapsed: boolean }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <RailButton
      icon={dark ? Sun : Moon}
      label={!mounted ? 'Theme' : dark ? 'Light mode' : 'Dark mode'}
      collapsed={collapsed}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    />
  )
}

/** The phone tab bar's "More": profile, theme, help and signing out. */
function UserMenu({
  user, collapsed, compact, onSignOut,
}: {
  user: NonNullable<SidebarProps['user']>
  collapsed: boolean
  /** The phone tab bar: an icon-and-label cell like its neighbours. */
  compact?: boolean
  onSignOut: () => void
}) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const name = user.name || 'Guest'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account and theme — ${name}`}
        className={cn(
          "flex items-center gap-2.5 rounded-lg text-left transition-colors focus-visible:outline-rail-active",
          compact
            ? "flex-col gap-1 text-[11px] font-medium text-rail-muted"
            : collapsed
              ? "h-10 w-10 justify-center hover:bg-rail-hover"
              : "w-full px-2 py-1.5 hover:bg-rail-hover",
        )}
      >
        {compact ? (
          <>
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            <span>More</span>
          </>
        ) : (
          <>
            <Identicon name={name} size={collapsed ? 30 : 32} />
            {!collapsed && (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-rail-foreground">{name}</span>
                <span className="truncate text-xs text-rail-muted">{user.email || 'No email'}</span>
              </span>
            )}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? 'top' : 'right'} align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
          <Identicon name={name} size={28} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{user.email || 'No email'}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="eyebrow py-1">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light"><Sun className="h-4 w-4" /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="h-4 w-4" /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor className="h-4 w-4" /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile"><UserRound className="h-4 w-4" /> Your profile</Link>
        </DropdownMenuItem>
        {compact && (
          <DropdownMenuItem asChild>
            <Link href="/help"><HelpCircle className="h-4 w-4" /> Help</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
