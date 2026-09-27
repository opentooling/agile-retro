import { Button } from "@/components/ui/button"
import Link from "next/link"
import { LogIn, KeyRound, HelpCircle } from "lucide-react"
import { StageScene } from "@/components/visual/Illustration"
import { LogoMark } from "@/components/visual/Logo"
import { ModeToggle } from "@/components/mode-toggle"
import { signIn, providerMap } from "@/auth"
import { branding } from "@/lib/branding"

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function getProviderIcon(id: string) {
  switch (id) {
    case "google":
      return <GoogleIcon className="w-5 h-5" />
    case "keycloak":
      return <KeyRound className="w-5 h-5" />
    default:
      return <LogIn className="w-5 h-5" />
  }
}

export default function LoginPage() {
  const { name, tagline } = branding()
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(26rem,1fr)]">
      {/* Left: the product, on ink — the same stage the board is. Hidden on
          small screens, where the sign-in is the whole page. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail p-12 text-rail-foreground lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">{name}</span>
        </div>
        <div className="max-w-xl">
          <p className="eyebrow !text-rail-muted">Team retrospectives</p>
          <h2 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-[-0.03em]">
            Look back together.<br />
            <span className="text-rail-active">Then follow through.</span>
          </h2>
          <StageScene className="mt-12 w-full max-w-lg" />
        </div>
        <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-rail-muted" aria-label="How a session runs">
          {['Input', 'Voting', 'Review', 'Actions'].map((phase, i) => (
            <li key={phase} className="flex items-center gap-2">
              <span className="font-mono text-xs tabular-nums">0{i + 1}</span>
              {phase}
            </li>
          ))}
        </ol>
      </aside>

      {/* Right: the sign-in itself. */}
      <main className="relative flex items-center justify-center bg-background px-6 py-12">
        <div className="absolute right-4 top-4">
          <ModeToggle />
        </div>
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="rounded-xl bg-rail p-1.5"><LogoMark className="h-8 w-8" /></span>
            <span className="text-lg font-semibold tracking-tight">{name}</span>
          </div>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight lg:mt-0">Sign in</h1>
          <p className="mt-2 text-muted-foreground">{tagline}</p>
          <div className="mt-8 space-y-3">
            {Object.values(providerMap).map((provider) => (
              <form
                key={provider.id}
                action={async () => {
                  "use server"
                  await signIn(provider.id, { redirectTo: "/" })
                }}
              >
                <Button className="h-12 w-full justify-start gap-3 bg-card px-4 text-base shadow-[var(--shadow-card)]" size="lg" type="submit" variant="outline">
                  {getProviderIcon(provider.id)}
                  Continue with {provider.name}
                </Button>
              </form>
            ))}
            {Object.values(providerMap).length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No sign-in provider is configured for this deployment.
              </p>
            )}
          </div>
          <p className="mt-10 border-t pt-4 text-xs text-muted-foreground">
            Your team&apos;s boards are visible to you through your identity provider&apos;s groups.{' '}
            <Link href="/help" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <HelpCircle className="h-3.5 w-3.5" aria-hidden /> How it works
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
