import * as db from '@/lib/db'
import RetroBoard from '@/components/RetroBoard'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { redactRetroFull, applyBlindInput } from '@/lib/sanitize'
import { authUserFromSession, canViewBoard, canManageBoard, type RetroRef } from '@/lib/authz'
import { reconcileActionsForRetro } from '@/lib/jira-sync'

import { auth } from '@/auth'

export default async function RetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  let retro = await db.getRetroFull(id)

  if (!retro) {
    notFound()
  }

  // Authorization. Team-aligned boards are restricted to their members /
  // team-admins / admins; open boards (no team) remain visible to any
  // authenticated user. This mirrors the checks enforced by the socket server.
  const authUser = authUserFromSession(session)
  const retroRef: RetroRef = { teamId: retro.teamId, creator: retro.creator, team: retro.team, status: retro.status }

  if (!canViewBoard(authUser, retroRef)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-muted">
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">You don&apos;t have access to this board</h1>
        <p className="max-w-md text-muted-foreground">
          This retrospective is aligned to the{' '}
          <span className="font-medium text-foreground">{retro.team?.name ?? 'a'}</span> team and is only
          visible to its members. Ask a team admin for access.
        </p>
        <Link href="/" className="mt-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-[var(--shadow-card)] hover:bg-accent">
          Back to home
        </Link>
      </div>
    )
  }

  // Poll-on-open: pull the latest done state from linked Jira issues so the
  // board's action items reflect changes made in Jira. Only after the access
  // check — it calls out with the team's Jira credentials, and used to run for
  // anyone who opened the link, even when the page then refused them.
  await reconcileActionsForRetro(id)
  retro = (await db.getRetroFull(id)) ?? retro

  const canManage = canManageBoard(authUser, retroRef)

  // Strip the Jira API token before handing the retro to the client component.
  return (
    <RetroBoard
      initialData={applyBlindInput(redactRetroFull(retro), authUser?.id) as any}
      user={session?.user}
      viewer={{
        id: authUser?.id ?? '',
        name: authUser?.name ?? null,
        isAdmin: authUser?.isAdmin ?? false,
        canManage,
      }}
    />
  )
}
