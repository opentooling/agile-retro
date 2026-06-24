import * as db from '../src/lib/db';

function main() {
    console.log('🗑️  Starting database cleanup...');

    try {
        db.clearDatabase();
        console.log('✅ Database cleanup complete!');
    } catch (error) {
        console.error('❌ Error cleaning database:', error);
        process.exit(1);
    }
}

main();
