import { NextResponse } from 'next/server'

/**
 * Liveness: this process is up and serving HTTP.
 *
 * Deliberately touches nothing else. A liveness probe that fails when the
 * database is unreachable would have Kubernetes restart every pod during a
 * database outage — which neither fixes the database nor keeps the app up,
 * and turns a degraded service into no service at all. Readiness is where a
 * dependency belongs: /api/ready.
 *
 * Unauthenticated, and says nothing beyond "ok": kubelet has no session, and
 * the version or an error here would be readable by anyone who can reach the
 * port.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
