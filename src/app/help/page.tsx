import Link from 'next/link'
import {
  Eye, EyeOff, ListTodo, Play, Star, Users, Clock, Trash2, SmilePlus,
  Shield, ExternalLink, LayoutDashboard, Pencil, Building2, RefreshCw,
} from 'lucide-react'
import { PageShell, PageHeader } from '@/components/PageHeader'
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
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
        <Icon className="h-5 w-5 text-primary" />
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}

const PHASES = [
  { name: 'Input', text: 'Everyone adds cards to the columns. Drag to reorder or move between columns.' },
  { name: 'Voting', text: 'Spend your votes on the cards you most want to discuss. You have 10 to spread as you like.' },
  { name: 'Review', text: 'Cards are pooled and sorted by votes. Discuss them in order and capture notes on each.' },
  { name: 'Actions', text: 'Agree what happens next. Action items carry into the team’s following retro until they’re done.' },
]

export default function HelpPage() {
  const { name } = branding()

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Help"
        action={
          <Link href="/" className="text-sm font-medium text-primary hover:underline">
            Back to dashboard
          </Link>
        }
      />

      <p className="mb-6 text-sm text-muted-foreground">
        {name} runs a retrospective as four timed phases. The facilitator — whoever created the
        board — moves it between them.
      </p>

      <div className="space-y-7">
        <Section id="phases" icon={Play} title="The four phases">
          <ol className="space-y-1.5">
            {PHASES.map((phase, i) => (
              <li key={phase.name} className="flex gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                  {i + 1}
                </span>
                <span><Term>{phase.name}</Term> — {phase.text}</span>
              </li>
            ))}
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
            <Term> @</Term> to mention someone.
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
          <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              A team with no groups configured is restricted to administrators. That&apos;s
              deliberate — access fails closed rather than open. If your team can&apos;t see a
              board, check its groups first.
            </span>
          </p>
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
          <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <span className="font-medium text-foreground">Joined a group but still can&apos;t
              see the board?</span> Your groups are read once, when you sign in. Sign out and back
              in to pick up a change — nothing in the app can refresh it for you.
            </span>
          </p>
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
          <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              The issue is created and transitioned as the account whose token you supplied, so it
              needs permission to create issues in that project and to move them to done. A
              missing transition is the usual reason an issue stops short of Done.
            </span>
          </p>
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
        </Section>

        <Section id="retention" icon={Clock} title="Retention and deleting a board">
          <p>A session can be given a lifetime when it&apos;s created:</p>
          <ul className="space-y-0.5">
            {RETENTION_OPTIONS.map((option) => (
              <li key={option.value}>{option.label}</li>
            ))}
          </ul>
          <p className="flex gap-2 rounded-md border border-red-200 bg-red-50/60 p-2.5 dark:border-red-900 dark:bg-red-950/20">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <span>
              When the lifetime elapses the board and everything on it — cards, votes, reactions
              and action items — is deleted automatically. Deleting a board by hand does the same
              thing immediately. Neither can be undone.
            </span>
          </p>
        </Section>

        <Section id="trouble" icon={Shield} title="If something looks wrong">
          <dl className="space-y-2">
            <div>
              <dt className="font-medium text-foreground">You can&apos;t open a team&apos;s board</dt>
              <dd>
                Your identity provider groups may not be reaching the app, or the team may have no
                groups bound. Ask an administrator to check the team&apos;s access groups.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">The board looks empty during input</dt>
              <dd>Blind input is probably on — a banner at the top of the board will say so.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">You were added to a group but still can&apos;t get in</dt>
              <dd>Sign out and back in — group membership is read at sign-in.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">No &ldquo;Create in Jira&rdquo; button</dt>
              <dd>
                The board has no team, or the team is missing one of the four Jira settings. All
                four are required.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">A Jira issue was created but never moves to Done</dt>
              <dd>
                The connected account may lack permission to transition it, or the project may have
                no available transition to a done status from where the issue is.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">A board you expected is gone</dt>
              <dd>It may have reached its retention limit, or been deleted by its facilitator.</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Signing out doesn&apos;t prompt you again</dt>
              <dd>
                Your identity provider still has an active session. Sign out there too, or use a
                private window.
              </dd>
            </div>
          </dl>
        </Section>
      </div>
    </PageShell>
  )
}
