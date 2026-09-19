import Link from 'next/link'
import { redirect } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Calendar, EyeOff, Lock, ShieldCheck, UserRound } from 'lucide-react'
import { auth } from '@/auth'
import * as db from '@/lib/db'
import { authUserFromSession, boardScopeFor, teamAccessLevel } from '@/lib/authz'
import { buildProfile, assigneeNamesFor } from '@/lib/profile'
import { SENTIMENT_LABEL } from '@/lib/column-sentiment'
import { PageShell } from '@/components/PageHeader'
import { Masthead, Figures, Figure, SectionTitle } from '@/components/Masthead'
import { PhaseBadge } from '@/components/PhaseBadge'
import { TeamMark } from '@/components/TeamMark'
import { Identicon } from '@/components/visual/Identicon'

/**
 * Your own profile: who the app thinks you are, what access that gives you,
 * and what you have done with it.
 *
 * Deliberately only ever your own. There is no route to anyone else's — a
 * per-person activity page for a manager to read is exactly what makes people
 * stop being honest in retros. Everything that names a board is limited to
 * boards you can open today (see lib/profile).
 */
export default async function ProfilePage() {
  const session = await auth()
  const user = authUserFromSession(session)
  if (!user) redirect('/login')

  const teams = await db.listTeams()
  const scope = boardScopeFor(user, teams)
  const creatorNames = [user.name, user.id, user.email].filter((v): v is string => Boolean(v))

  const [raw, assigned] = await Promise.all([
    db.userActivity(user.id, creatorNames),
    db.listActionItems({ scope, assigneeIn: assigneeNamesFor(user.name, user.email) }),
  ])
  const profile = buildProfile(raw, scope)

  const now = new Date()
  const open = assigned.filter((a) => !a.completed)
  const overdue = open.filter((a) => a.dueDate && a.dueDate < now)
  const done = assigned.length - open.length

  const myTeams = teams
    .map((team) => ({ team, access: teamAccessLevel(user, team) }))
    .filter((t) => t.access !== 'none')

  const name = user.name || user.email || user.id

  return (
    <PageShell width="wide">
      <Masthead
        eyebrow="Your profile"
        icon={UserRound}
        title={
          <span className="flex items-center gap-4">
            <Identicon name={name} size={56} />
            <span className="min-w-0 truncate">{name}</span>
          </span>
        }
        lede={
          <>
            {user.email && <span>{user.email}</span>}
            {profile.lastActive && (
              <span>{user.email ? ' · ' : ''}Last active {formatDistanceToNow(profile.lastActive, { addSuffix: true })}</span>
            )}
          </>
        }
        actions={
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Only you can see this page
          </span>
        }
      >
        <Figures className="mt-6" columns={5}>
          <Figure value={profile.stats.boardsRun} label="Retros you ran" tone="review" href="/history?view=mine" />
          <Figure value={profile.stats.boardsJoined} label="Retros you joined" tone="improve" />
          <Figure value={profile.stats.cards} label="Cards written" tone="positive" />
          <Figure value={profile.stats.stars} label="Stars given" tone="risk" />
          <Figure value={profile.stats.reactions} label="Reactions" tone="negative" />
        </Figures>
      </Masthead>

      <div className="grid gap-10 @container lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="assigned">
            <SectionTitle
              id="assigned"
              aside={<Link href="/actions" className="font-medium text-primary hover:underline">All actions</Link>}
            >
              Assigned to you
            </SectionTitle>
            <p className="mb-3 text-sm text-muted-foreground">
              <strong className="font-semibold text-foreground">{open.length}</strong> open
              {overdue.length > 0 && (
                <> · <strong className="font-semibold text-[hsl(var(--tone-negative-ink))]">{overdue.length} overdue</strong></>
              )}
              {' · '}{done} done
            </p>
            {open.length === 0 ? (
              <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                Nothing open with your name on it.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {open.slice(0, 8).map((a) => {
                  const late = a.dueDate && a.dueDate < now
                  return (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: `hsl(var(--tone-${late ? 'negative' : 'positive'}))` }} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-snug">{a.content}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <Link href={`/retro/${a.retrospectiveId}`} className="hover:text-foreground hover:underline">
                            {a.retrospective.title}
                          </Link>
                          {a.dueDate && (
                            <span className={late ? 'flex items-center gap-1 font-semibold text-[hsl(var(--tone-negative-ink))]' : 'flex items-center gap-1'}>
                              <Calendar className="h-3 w-3" aria-hidden />
                              {late ? 'Overdue · ' : 'Due '}
                              {a.dueDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="recent-cards">
            <SectionTitle id="recent-cards">Your recent cards</SectionTitle>
            {profile.recentCards.length === 0 ? (
              <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                You haven&apos;t written a card yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {profile.recentCards.map((c) => (
                  <li key={c.id} className="rounded-xl border bg-card px-4 py-3">
                    <p className="whitespace-pre-wrap leading-snug">{c.content}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <Link href={`/retro/${c.retroId}`} className="font-medium hover:text-foreground hover:underline">{c.retroTitle}</Link>
                      <span>{c.columnTitle}</span>
                      <span>{formatDistanceToNow(c.createdAt, { addSuffix: true })}</span>
                      {c.isAnonymous && (
                        <span className="flex items-center gap-1" title="Others see this card without your name">
                          <EyeOff className="h-3 w-3" aria-hidden /> Anonymous board
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-10">
          <section aria-labelledby="raises">
            <SectionTitle id="raises">What you raise</SectionTitle>
            {profile.raises.length === 0 ? (
              <p className="text-sm text-muted-foreground">Write a few cards and this fills in.</p>
            ) : (
              <>
                <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img"
                  aria-label={profile.raises.map((r) => `${SENTIMENT_LABEL[r.sentiment]} ${Math.round(r.share * 100)}%`).join(', ')}>
                  {profile.raises.map((r) => (
                    <span key={r.sentiment} style={{ width: `${r.share * 100}%`, background: `hsl(var(--tone-${r.sentiment}))` }} />
                  ))}
                </div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {profile.raises.map((r) => (
                    <li key={r.sentiment} className="flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `hsl(var(--tone-${r.sentiment}))` }} />
                      <span className="flex-1">{SENTIMENT_LABEL[r.sentiment]}</span>
                      <span className="tabular-nums text-muted-foreground">{r.count} · {Math.round(r.share * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="ran">
            <SectionTitle id="ran">Retros you ran</SectionTitle>
            {profile.recentBoardsRun.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet — start one from Home.</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {profile.recentBoardsRun.map((b) => (
                  <li key={b.id}>
                    <Link href={`/retro/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
                      <PhaseBadge status={b.status} className="w-[5.5rem] shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDistanceToNow(b.createdAt, { addSuffix: true })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="access">
            <SectionTitle id="access">Your access</SectionTitle>
            {user.isAdmin && (
              <p className="mb-3 flex items-center gap-2 rounded-lg bg-[hsl(var(--tone-review-soft))] px-3 py-2 text-sm font-medium text-[hsl(var(--tone-review-ink))]">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Administrator — you can open every board.
              </p>
            )}
            {myTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">You aren&apos;t in any team yet. Open boards are still yours to join.</p>
            ) : (
              <ul className="space-y-1.5">
                {myTeams.map(({ team, access }) => (
                  <li key={team.id} className="flex items-center gap-2.5 text-sm">
                    <TeamMark team={team} size={22} />
                    <span className="min-w-0 flex-1 truncate font-medium">{team.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {access === 'admin' ? 'Team admin' : 'Member'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                Groups from your sign-in ({user.groups.length})
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                Team access comes from these. If a team you expect is missing, this list is what to check.
              </p>
              {user.groups.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Your sign-in carried no groups.</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {user.groups.map((g) => (
                    <li key={g} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{g}</li>
                  ))}
                </ul>
              )}
            </details>
          </section>
        </aside>
      </div>
    </PageShell>
  )
}
