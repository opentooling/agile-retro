import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LogIn, KeyRound, Coins, Sparkles } from "lucide-react"
import { BlobField, TeamScene } from "@/components/visual/Illustration"
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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Left: the pitch, on colour. Hidden on small screens, where the card
          is the whole page. */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[hsl(var(--tone-improve-soft))] via-[hsl(var(--accent))] to-[hsl(var(--tone-review-soft))] p-12 lg:flex lg:flex-col lg:justify-center">
        <BlobField stretch={false} className="pointer-events-none absolute inset-0 h-full w-full opacity-50" />
        <div className="relative max-w-md">
          <span className="inline-flex items-center gap-2 rounded-full bg-card/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> Team retrospectives
          </span>
          <h2 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-foreground">
            Look back together,<br />then actually follow through.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">{tagline}</p>
          <TeamScene className="mt-10 w-full max-w-sm" />
        </div>
      </aside>

      {/* Right: the sign-in itself. */}
      <main className="flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border-none bg-transparent shadow-none">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-3">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md">
                <Coins className="h-7 w-7" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Welcome to {name}</CardTitle>
            <CardDescription>Sign in to create or join a retrospective.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.values(providerMap).map((provider) => (
              <form
                key={provider.id}
                action={async () => {
                  "use server"
                  await signIn(provider.id, { redirectTo: "/" })
                }}
              >
                <Button className="w-full gap-2 shadow-sm" size="lg" type="submit" variant="outline">
                  {getProviderIcon(provider.id)}
                  Sign in with {provider.name}
                </Button>
              </form>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
