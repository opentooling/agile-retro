import * as db from '@/lib/db'
import RetroBoard from '@/components/RetroBoard'
import { notFound } from 'next/navigation'

import { auth } from '@/auth'

export default async function RetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const retro = db.getRetroFull(id)

  if (!retro) {
    notFound()
  }

  return <RetroBoard initialData={retro as any} user={session?.user} />
}
