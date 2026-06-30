'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'
import { createExternalTaskForAction } from '@/app/actions'

/**
 * Client button that creates a Jira issue for an action item via the
 * `createExternalTaskForAction` server action. Used on the Actions list page.
 * If the action is already linked, it renders the link instead.
 */
export function JiraActionButton({
  actionId,
  externalUrl,
  externalKey,
}: {
  actionId: string
  externalUrl?: string | null
  externalKey?: string | null
}) {
  const [link, setLink] = useState<{ url: string; key: string } | null>(
    externalUrl && externalKey ? { url: externalUrl, key: externalKey } : null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (link) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
      >
        <ExternalLink className="w-3 h-3" /> {link.key}
      </a>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            setLink(await createExternalTaskForAction(actionId, 'jira'))
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to create Jira issue')
          } finally {
            setBusy(false)
          }
        }}
      >
        <ExternalLink className="w-3 h-3" /> {busy ? 'Creating…' : 'Create in Jira'}
      </Button>
      {error && <span className="text-xs text-red-500 max-w-[220px] text-right">{error}</span>}
    </div>
  )
}
