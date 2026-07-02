import * as db from '@/lib/db'
import RetroBoard from '@/components/RetroBoard'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { redactRetroFull } from '@/lib/sanitize'
import { authUserFromSession, canViewBoard, canManageBoard, type RetroRef } from '@/lib/authz'
import { reconcileActionsForRetro } from '@/lib/jira-sync'

import { auth } from '@/auth'

export default async function RetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  // Poll-on-open: pull the latest done state from linked Jira issues so the
  // board's action items reflect changes made in Jira.
  await reconcileActionsForRetro(id)

  const retro = await db.getRetroFull(id)

  if (!retro) {
    notFound()
  }

  // Authorization. Team-aligned boards are restricted to their members /
  // team-admins / admins; open boards (no team) remain visible to any
  // authenticated user. This mirrors the checks enforced by the socket server.
  const authUser = authUserFromSession(session)
  const retroRef: RetroRef = { teamId: retro.teamId, creator: retro.creator, team: retro.team }

  if (!canViewBoard(authUser, retroRef)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-bold">You don&apos;t have access to this board</h1>
        <p className="max-w-md text-muted-foreground">
          This retrospective is aligned to the{' '}
          <span className="font-medium">{retro.team?.name ?? 'a'}</span> team and is only
          visible to its members. Ask a team admin for access.
        </p>
        <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const canManage = canManageBoard(authUser, retroRef)

  // Strip the Jira API token before handing the retro to the client component.
  return (
    <RetroBoard
      initialData={redactRetroFull(retro) as any}
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
