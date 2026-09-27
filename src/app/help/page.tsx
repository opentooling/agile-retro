import Link from 'next/link'
import {
  Eye, EyeOff, ListTodo, Play, Star, Users, Clock, Trash2, SmilePlus,
  Shield, ExternalLink, LayoutDashboard, Pencil, Building2, RefreshCw, BookOpen } from 'lucide-react'
import { PageShell } from '@/components/PageHeader'
import { Masthead } from '@/components/Masthead'
import { PHASE_ICON, PHASE_TONE } from '@/components/PhaseBadge'
import { cn } from '@/lib/utils'
import { RETRO_TEMPLATES } from '@/lib/retro-templates'
import { RETENTION_OPTIONS } from '@/lib/retention'
import { branding } from '@/lib/branding'

/**
 * In-app help.
 *
 * Written as components rather than rendered from a markdown file: the file was
 * read from disk at request time, which meant it silently disappeared if the
 * image didn't ship `docs/`, and its internal links pointed at other `.md`
 * files that have no route and returned 404. Anything here that mirrors real
 * configuration — the retro formats, the retention choices — is read from the
 * same modules the app uses, so it can't drift.
 */

function Section({
  id, icon: Icon, title, children,
}: {
  id: string
  icon: typeof Eye
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t pt-8 first:border-t-0 first:pt-0">
      <h2 className="mb-3 flex items-center gap-2.5 text-xl font-semibold tracking-tight">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

/** A note that needs to stand out: a tone-tinted aside, not a fixed amber box. */
function Callout({ tone, icon: Icon, children }: { tone: 'risk' | 'negative'; icon: typeof Eye; children: React.ReactNode }) {
  return (
    <p
      className="flex gap-2.5 rounded-lg p-3 text-sm"
      style={{ background: `hsl(var(--tone-${tone}-soft))`, color: `hsl(var(--tone-${tone}-ink))` }}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const TOC: { id: string; label: string }[] = [
  { id: 'phases', label: 'The four phases' },
  { id: 'formats', label: 'Board formats' },
  { id: 'privacy', label: 'Anonymous and blind input' },
  { id: 'voting', label: 'Voting' },
  { id: 'review', label: 'Review and reactions' },
  { id: 'actions', label: 'Action items' },
  { id: 'teams', label: 'Teams and access' },
  { id: 'directory', label: 'Where access comes from' },
  { id: 'jira', label: 'Jira' },
  { id: 'editing', label: 'Editing and moderating' },
  { id: 'retention', label: 'Retention and deleting' },
  { id: 'trouble', label: 'If something looks wrong' },
]

function Term({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}

const PHASES = [
  { id: 'INPUT', name: 'Input', text: 'Everyone adds cards to the columns. Drag a card by its handle, or use its ⋯ menu, to reorder, move or delete it.' },
  { id: 'VOTING', name: 'Voting', text: 'Spend your votes on the cards you most want to discuss. You have 10 to spread as you like.' },
  { id: 'REVIEW', name: 'Review', text: 'Cards are pooled and sorted by votes. Discuss them in order and capture notes on each.' },
  { id: 'ACTIONS', name: 'Actions', text: 'Agree what happens next. Action items carry into the team’s following retro until they’re done.' },
]

export default function HelpPage() {
  const { name } = branding()

  return (
    <PageShell>
      <Masthead
        eyebrow="Guide"
        icon={BookOpen}
        title="How it works"
        lede={`${name} runs a retrospective as four timed phases. The facilitator — whoever created the board — moves it between them.`}
        actions={
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to home
          </Link>
        }
      />

      <div className="@container">
      <div className="grid gap-10 @min-[52rem]:grid-cols-[13rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="@min-[52rem]:sticky @min-[52rem]:top-8 @min-[52rem]:self-start">
        <p className="eyebrow mb-2">On this page</p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm @min-[52rem]:flex-col @min-[52rem]:gap-0 @min-[52rem]:border-l">
          {TOC.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className="-ml-px block border-l border-transparent py-1 text-muted-foreground hover:text-foreground @min-[52rem]:pl-3 @min-[52rem]:hover:border-foreground"
              >
                {entry.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="min-w-0 max-w-3xl space-y-10">
        <Section id="phases" icon={Play} title="The four phases">
          {/* The phases as the board draws them: a track of four segments. */}
          <ol className="grid gap-3 @xl:grid-cols-2 @min-[60rem]:grid-cols-4">
            {PHASES.map((phase, i) => {
              const Icon = PHASE_ICON[phase.id]
              const tone = PHASE_TONE[phase.id]
              return (
                <li key={phase.name} className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
                  <span aria-hidden className="block h-1.5 rounded-full" style={{ background: `hsl(var(--tone-${tone}))` }} />
                  <span className="mt-3 flex items-center gap-2 font-semibold text-foreground">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-lg"
                      style={{ background: `hsl(var(--tone-${tone}-soft))`, color: `hsl(var(--tone-${tone}-ink))` }}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span><span className="sr-only">Phase {i + 1}: </span>{phase.name}</span>
                  </span>
                  <span className="mt-2 block text-sm">{phase.text}</span>
                </li>
              )
            })}
          </ol>
          <p>
            The clock is a guide, not a gate. When time runs out the board stays where it is and
            the timer counts upwards as <Term>Overtime</Term> — only the facilitator moves it on.
            They can also snooze for another five minutes.
          </p>
        </Section>

        <Section id="formats" icon={LayoutDashboard} title="Board formats">
          <p>Pick a format when you create a session. It decides the columns:</p>
          <ul className="space-y-1">
            {RETRO_TEMPLATES.map((template) => (
              <li key={template.id}>
                <Term>{template.name}</Term> — {template.columns.map((c) => c.title).join(' · ')}
              </li>
            ))}
          </ul>
          <p>The format is fixed once the board is created.</p>
        </Section>

        <Section id="privacy" icon={EyeOff} title="Anonymous and blind input">
          <p>
            <Term>Anonymous</Term> hides who wrote each card, for the whole session.
          </p>
          <p>
            <Term>Blind input</Term> hides other people&apos;s cards until the input phase ends, so
            the first few cards don&apos;t anchor everyone else&apos;s thinking. You still see a
            count of how many cards others have written. Both are chosen at creation and can&apos;t
            be changed later.
          </p>
        </Section>

        <Section id="voting" icon={Star} title="Voting">
          <p>
            You get <Term>10 votes</Term> per session and can stack more than one on a card. Click
            a star to set your vote count for that card; click the star you&apos;re already on to
            step back down. Your remaining budget is in the board header.
          </p>
        </Section>

        <Section id="review" icon={Eye} title="Review and reactions">
          <p>
            Review pools every card, colour-coded by the column it came from, sorted by votes.
            Cards nobody voted for appear under <Term>Also raised</Term> — they&apos;re still worth
            a look if there&apos;s time.
          </p>
          <p>
            Add notes on a card as you discuss it; they&apos;re saved automatically and appear in
            the PDF export. Anyone can add an emoji <SmilePlus className="inline h-3.5 w-3.5" />{' '}
            reaction, including people who have spent all their votes.
          </p>
        </Section>

        <Section id="actions" icon={ListTodo} title="Action items">
          <p>
            Add actions in the Actions phase, with an optional assignee and due date. Use
            <Term> @</Term> to mention someone. While the phase is running anyone on the board can
            edit or delete an action — drafting the list is a group job. Once the retro moves on,
            the list is the record.
          </p>
          <p>
            Open actions from a team&apos;s previous retros appear at the top of its next board, so
            they get revisited rather than forgotten. Tick one off there or on the{' '}
            <Link href="/actions" className="text-primary hover:underline">Actions</Link> page.
          </p>
          <p>
            If the team has Jira configured, an action can be pushed to Jira{' '}
            <ExternalLink className="inline h-3.5 w-3.5" /> and its done state stays in sync both
            ways — see <a href="#jira" className="text-primary hover:underline">Jira</a> below.
          </p>
        </Section>

        <Section id="teams" icon={Users} title="Teams and who can see a board">
          <p>
            A board with no team is an <Term>open board</Term>: any signed-in user can view and
            join it.
          </p>
          <p>
            A board aligned to a team is restricted to that team. Membership comes from your
            identity provider&apos;s groups, bound to the team in{' '}
            <Link href="/teams" className="text-primary hover:underline">Teams</Link>:{' '}
            <Term>member groups</Term> can view and participate, <Term>admin groups</Term> can also
            manage the board. The team&apos;s creator is always an admin of it.
          </p>
          <Callout tone="risk" icon={Shield}>
            <span>
              A team with no groups configured is restricted to administrators. That&apos;s
              deliberate — access fails closed rather than open. If your team can&apos;t see a
              board, check its groups first.
            </span>
          </Callout>
        </Section>

        <Section id="directory" icon={Building2} title="Where your access comes from">
          <p>
            You are not added to a team inside this app. Membership follows the groups you are
            already in — typically <Term>Active Directory</Term> groups, federated into Keycloak
            and sent to the app when you sign in. A team is bound to one or more of those group
            names, and everyone in them can open that team&apos;s boards.
          </p>
          <p>
            Group names are matched leniently: case is ignored, and a team may be bound either to
            a group&apos;s full path or just its last segment.
          </p>
          <Callout tone="risk" icon={RefreshCw}>
            <span>
              <span className="font-semibold">Joined a group but still can&apos;t
              see the board?</span> Your groups are read once, when you sign in. Sign out and back
              in to pick up a change — nothing in the app can refresh it for you.
            </span>
          </Callout>
          <p>
            Administrators: the groups arrive in the ID token&apos;s <Term>user_roles</Term> claim
            (configurable, and it falls back to <Term>groups</Term>). If nobody can open a team&apos;s
            boards, that claim is usually missing from the ID token rather than the team being
            misconfigured. Full setup, including the LDAP group sync and the Group Membership
            mapper, is in <Term>docs/KEYCLOAK_GROUPS.md</Term>.
          </p>
        </Section>

        <Section id="jira" icon={ExternalLink} title="Jira">
          <p>
            Jira is connected <Term>per team</Term>, on the{' '}
            <Link href="/teams" className="text-primary hover:underline">Teams</Link> page. A team
            admin fills in four things — all four are required before anything appears:
          </p>
          <ul className="space-y-0.5">
            <li><Term>Base URL</Term> — the address of your Jira instance</li>
            <li><Term>Project key</Term> — the project new issues are raised in</li>
            <li><Term>Account email</Term> — the account the issues are created as</li>
            <li><Term>API token</Term> — created in that account&apos;s security settings, not your password</li>
          </ul>
          <p>
            Once connected, any action item on that team&apos;s boards gets a{' '}
            <Term>Create in Jira</Term> button. It raises a <Term>Task</Term> in the project and
            links the two, showing the issue key from then on. The assignee is matched to a Jira
            user where possible; when it can&apos;t be matched the name is kept in the issue
            description rather than being dropped.
          </p>
          <p>
            <Term>Done state syncs both ways.</Term> Ticking the action off transitions the issue
            to a done status; moving the issue to done in Jira ticks off the action. Reopening
            works in both directions too. The Jira side is read when you open a board or the
            Actions page — there is no webhook — so a change made in Jira appears the next time
            you look, not instantly.
          </p>
          <Callout tone="risk" icon={Shield}>
            <span>
              The issue is created and transitioned as the account whose token you supplied, so it
              needs permission to create issues in that project and to move them to done. A
              missing transition is the usual reason an issue stops short of Done.
            </span>
          </Callout>
          <p>
            Setup detail, network requirements for self-hosted Jira, and how to add another
            tracker are in <Term>docs/JIRA_INTEGRATION.md</Term>.
          </p>
        </Section>

        <Section id="editing" icon={Pencil} title="Editing and moderating">
          <p>
            You can always edit your own cards. The facilitator, a team admin and administrators
            can edit anyone&apos;s card, change phase, extend the timer and delete the board.
          </p>
          <p>
            During <Term>Input</Term> the same people can also move a card — to another column or up
            and down within one — and delete it. Drag it by the <Term>⋮⋮</Term> handle, or use the
            card&apos;s <Term>⋯</Term> menu, which works by keyboard and on touch screens too. Once
            voting starts, cards stay where they are: moving or deleting one then would quietly
            rearrange votes people have already cast.
          </p>
          <p>
            Your <Link href="/profile" className="text-primary hover:underline">profile</Link> shows
            what you have run, written and been assigned, and which teams and groups your access
            comes from. Only you can see it.
          </p>
        </Section>

        <Section id="retention" icon={Clock} title="Retention and deleting a board">
          <p>A session can be given a lifetime when it&apos;s created:</p>
          <ul className="space-y-0.5">
            {RETENTION_OPTIONS.map((option) => (
              <li key={option.value}>{option.label}</li>
            ))}
          </ul>
          <Callout tone="negative" icon={Trash2}>
            <span>
              When the lifetime elapses the board and everything on it — cards, votes, reactions
              and action items — is deleted automatically. Deleting a board by hand does the same
              thing immediately. Neither can be undone.
            </span>
          </Callout>
        </Section>

        <Section id="trouble" icon={Shield} title="If something looks wrong">
          <dl className="divide-y rounded-xl border bg-card px-4 [&>div]:py-3">
            <div>
              <dt className="font-semibold text-foreground">You can&apos;t open a team&apos;s board</dt>
              <dd>
                Your identity provider groups may not be reaching the app, or the team may have no
                groups bound. Ask an administrator to check the team&apos;s access groups.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">The board looks empty during input</dt>
              <dd>Blind input is probably on — a banner at the top of the board will say so.</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">You were added to a group but still can&apos;t get in</dt>
              <dd>Sign out and back in — group membership is read at sign-in.</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">No &ldquo;Create in Jira&rdquo; button</dt>
              <dd>
                The board has no team, or the team is missing one of the four Jira settings. All
                four are required.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">A Jira issue was created but never moves to Done</dt>
              <dd>
                The connected account may lack permission to transition it, or the project may have
                no available transition to a done status from where the issue is.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">A board you expected is gone</dt>
              <dd>It may have reached its retention limit, or been deleted by its facilitator.</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Signing out doesn&apos;t prompt you again</dt>
              <dd>
                Your identity provider still has an active session. Sign out there too, or use a
                private window.
              </dd>
            </div>
          </dl>
        </Section>
      </div>
      </div>
      </div>
    </PageShell>
  )
}
