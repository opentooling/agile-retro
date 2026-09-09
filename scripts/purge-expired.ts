/**
 * Delete boards whose retention (TTL) has elapsed.
 *
 * The application sweeps on its own timer, so this is only needed to force a
 * sweep by hand or to run one from a scheduled job (e.g. a Kubernetes CronJob)
 * when the app itself is not running.
 *
 *   npm run db:purge
 */
import { purgeExpiredRetros } from '../src/lib/purge'

purgeExpiredRetros()
    .then((deleted) => {
        console.log(
            deleted.length === 0
                ? '[purge] nothing expired'
                : `[purge] deleted ${deleted.length} expired board(s): ${deleted.join(', ')}`
        )
        process.exit(0)
    })
    .catch((err) => {
        console.error('[purge] failed:', err)
        process.exit(1)
    })
