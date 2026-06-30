import * as db from '@/lib/db'
import RetroBoard from '@/components/RetroBoard'
import { notFound } from 'next/navigation'
import { redactRetroFull } from '@/lib/sanitize'

import { auth } from '@/auth'

export default async function RetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const retro = await db.getRetroFull(id)

  if (!retro) {
    notFound()
  }

  // Strip the Jira API token before handing the retro to the client component.
  return <RetroBoard initialData={redactRetroFull(retro) as any} user={session?.user} />
}
