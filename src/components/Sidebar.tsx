'use client'

import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { LayoutDashboard, History, Filter, Tag, LogOut, LogIn, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
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
}

export function Sidebar({ user, keycloakIssuer }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [popularTags, setPopularTags] = useState<{tag: string, count: number}[]>([])
  const { data: session } = useSession()
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    getPopularTags().then(setPopularTags)
  }, [])

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
    if (session?.provider === 'keycloak' && keycloakIssuer) {
        const idToken = session.id_token
        let logoutUrl = `${keycloakIssuer}/protocol/openid-connect/logout?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`
        
        if (idToken) {
            logoutUrl += `&id_token_hint=${idToken}`
        }
        
        await signOut({ redirectTo: logoutUrl })
    } else {
        await signOut()
    }
  }

  const NavItem = ({ href, icon: Icon, label }: { href: string, icon: any, label: string }) => {
    const isActive = pathname === href
    
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

  return (
    <div className={cn(
      "border-r bg-muted/20 h-screen sticky top-0 flex flex-col transition-all duration-300",
      isCollapsed ? "w-16 p-2" : "w-64 p-6"
    )}>
      <div className="flex justify-end mb-4">
        <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(!isCollapsed)}>
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto">
        <div>
          {!isCollapsed && (
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5" />
              Navigation
            </h2>
          )}
          <nav className="flex flex-col gap-2">
            <NavItem href="/" icon={LayoutDashboard} label="Dashboard" />
            <NavItem href="/history" icon={History} label="History" />
          </nav>
        </div>

        {!isCollapsed && (
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filters
            </h2>
            <div className="space-y-4">
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
                  <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Tag className="w-3 h-3" />
                    Popular Tags
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {popularTags.map(({ tag, count }) => (
                      <Badge
                        key={tag}
                        variant={searchParams.get('tag') === tag ? "default" : "secondary"}
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => handleFilterChange('tag', tag)}
                      >
                        {tag} ({count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-4 mt-auto">
        {user ? (
          <div className={cn("border-t border-gray-200 dark:border-gray-800", !isCollapsed && "p-4")}>
            <div className={cn("flex items-center mb-4", isCollapsed ? "justify-center flex-col gap-2" : "justify-between")}>
                {!isCollapsed && (
                  <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shrink-0">
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
