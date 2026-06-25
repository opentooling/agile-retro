import * as db from '../src/lib/db';

async function main() {
    console.log('🗑️  Starting database cleanup...');

    try {
        await db.clearDatabase();
        console.log('✅ Database cleanup complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error cleaning database:', error);
        process.exit(1);
    }
}

main();
