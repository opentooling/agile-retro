import { NextResponse } from 'next/server'
import * as db from '@/lib/db'

/**
 * Readiness: this pod can serve requests, which means it can reach its
 * database — every page reads one.
 *
 * A failure takes the pod out of the Service's endpoints until it recovers,
 * rather than restarting it (see /api/health). The reason is logged rather
 * than returned: the endpoint is reachable by anyone who can reach the port,
 * and a database error names hosts and users.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.ping()
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Readiness check failed:', error)
    return NextResponse.json({ status: 'unavailable' }, { status: 503 })
  }
}
