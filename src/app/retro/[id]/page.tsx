import { prisma } from '@/lib/prisma'
import RetroBoard from '@/components/RetroBoard'
import { notFound } from 'next/navigation'

import { auth } from '@/auth'

export default async function RetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const retro = await prisma.retrospective.findUnique({
    where: { id },
    include: {
      columns: {
        include: {
          items: {
            include: {
              votes: true
            }
          }
        }
      },
      actions: true
    }
  })

  if (!retro) {
    notFound()
  }

  return <RetroBoard initialData={retro as any} user={session?.user} />
}
