import { prisma } from '../src/lib/prisma';

async function main() {
    console.log('🗑️  Starting database cleanup...');

    try {
        await prisma.$transaction(async (tx) => {
            // 1. Delete leaf nodes (Reaction, Vote)
            console.log('Deleting Reactions...');
            await tx.reaction.deleteMany();

            console.log('Deleting Votes...');
            await tx.vote.deleteMany();

            // 2. Delete Items (depend on Column)
            console.log('Deleting Items...');
            await tx.item.deleteMany();

            // 3. Delete Columns (depend on Retrospective)
            console.log('Deleting Columns...');
            await tx.column.deleteMany();

            // 4. Delete ActionItems (depend on Retrospective)
            console.log('Deleting ActionItems...');
            await tx.actionItem.deleteMany();

            // 5. Delete Retrospectives (Root of Retro tree, but depends on Team)
            console.log('Deleting Retrospectives...');
            await tx.retrospective.deleteMany();

            // 6. Delete Teams
            console.log('Deleting Teams...');
            await tx.team.deleteMany();
        });

        console.log('✅ Database cleanup complete!');
    } catch (error) {
        console.error('❌ Error cleaning database:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
