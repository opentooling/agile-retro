import { PrismaClient } from '@prisma/client'

async function main() {
    const prisma = new PrismaClient()
    console.log('Prisma initialized')
    await prisma.$disconnect()
}

main().catch(console.error)
