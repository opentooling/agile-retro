'use client'

import { useEffect, useState } from 'react'
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { X } from 'lucide-react'

/**
 * Fetches the identity provider's groups for picker suggestions. Returns
 * `configured: false` when the Keycloak Admin service account isn't set up, in
 * which case callers fall back to free-text entry.
 */
export function useKeycloakGroups(): { configured: boolean; groups: string[]; loading: boolean } {
  const [state, setState] = useState<{ configured: boolean; groups: string[]; loading: boolean }>({
    configured: false,
    groups: [],
    loading: true,
  })

  useEffect(() => {
    let cancelled = false
    fetch('/api/keycloak/groups')
      .then((r) => (r.ok ? r.json() : { configured: false, groups: [] }))
      .then((data) => {
        if (cancelled) return
        setState({
          configured: Boolean(data?.configured),
          groups: Array.isArray(data?.groups) ? data.groups : [],
          loading: false,
        })
      })
      .catch(() => {
        if (!cancelled) setState({ configured: false, groups: [], loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/**
 * Editor for a list of group identifiers. Renders the current groups as
 * removable chips plus an input to add more. When `suggestions` are available
 * (Keycloak Admin API configured) the input offers autocomplete via a datalist;
 * otherwise it's plain free-text entry.
 */
export function GroupsField({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  datalistId,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
  datalistId: string
}) {
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    if (value.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...value, trimmed])
    setDraft('')
  }

  const remove = (g: string) => onChange(value.filter((v) => v !== g))

  const available = (suggestions ?? []).filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())
  )

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((g) => (
            <span
              key={g}
              className="bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-xs flex items-center gap-1"
            >
              {g}
              <button type="button" aria-label={`Remove ${g}`} className="hover:text-destructive" onClick={() => remove(g)}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        className="h-8"
        list={datalistId}
        value={draft}
        placeholder={placeholder ?? 'Add a group and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
        }}
        onBlur={() => add(draft)}
      />
      {available.length > 0 && (
        <datalist id={datalistId}>
          {available.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  )
}
