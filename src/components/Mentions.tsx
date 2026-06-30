'use client'

import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Render text with @mentions highlighted. Known names (e.g. session
 * participants) are matched first so multi-word names highlight fully; any
 * remaining `@token` is highlighted as a fallback.
 */
export function MentionText({ text, names = [] }: { text: string; names?: string[] }) {
  const regex = useMemo(() => {
    const known = [...new Set(names.filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map((n) => `@${escapeRegExp(n)}`)
    const parts = [...known, '@[\\w][\\w.\\-]*']
    return new RegExp(`(${parts.join('|')})`, 'g')
  }, [names])

  const segments = useMemo(() => text.split(regex), [text, regex])

  return (
    <>
      {segments.map((seg, i) =>
        seg && seg.startsWith('@') ? (
          <span
            key={i}
            className="font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 rounded px-0.5"
          >
            {seg}
          </span>
        ) : (
          <React.Fragment key={i}>{seg}</React.Fragment>
        )
      )}
    </>
  )
}

type MentionInputProps = {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder?: string
  className?: string
  multiline?: boolean
  disabled?: boolean
  /** Called on Enter when the suggestion dropdown is not open. */
  onEnter?: () => void
}

/**
 * Text field with `@` autocomplete. Drawing pool is `suggestions` (e.g. live
 * participants); free text is always allowed. Selecting a suggestion inserts
 * `@Name ` at the caret.
 */
export function MentionInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  multiline = false,
  disabled = false,
  onEnter,
}: MentionInputProps) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [tokenStart, setTokenStart] = useState<number>(0)
  const [highlight, setHighlight] = useState(0)

  const matches = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase().replace(/\s/g, '')
    return [...new Set(suggestions.filter(Boolean))]
      .filter((s) => s.toLowerCase().replace(/\s/g, '').includes(q))
      .slice(0, 6)
  }, [query, suggestions])

  const open = query !== null && matches.length > 0

  useEffect(() => {
    setHighlight(0)
  }, [query])

  // Detect an active `@token` immediately before the caret.
  const refreshQuery = (el: HTMLTextAreaElement | HTMLInputElement) => {
    const caret = el.selectionStart ?? el.value.length
    const before = el.value.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\w.\-]*)$/)
    if (m) {
      setQuery(m[1])
      setTokenStart(caret - m[1].length - 1) // index of '@'
    } else {
      setQuery(null)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    onChange(e.target.value)
    refreshQuery(e.target)
  }

  const selectMatch = (name: string) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart ?? value.length
    const next = value.slice(0, tokenStart) + `@${name} ` + value.slice(caret)
    onChange(next)
    setQuery(null)
    // Restore focus and place caret after the inserted mention.
    const newCaret = tokenStart + name.length + 2
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(newCaret, newCaret)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => (h + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => (h - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMatch(matches[highlight])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
      if (onEnter) {
        e.preventDefault()
        onEnter()
      }
    }
  }

  const commonProps = {
    ref: ref as any,
    value,
    placeholder,
    disabled,
    className,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: () => setTimeout(() => setQuery(null), 120),
    onClick: (e: React.MouseEvent<HTMLTextAreaElement | HTMLInputElement>) =>
      refreshQuery(e.currentTarget),
  }

  return (
    <div className="relative w-full">
      {multiline ? <Textarea {...commonProps} /> : <Input {...commonProps} />}
      {open && (
        <ul className="absolute z-50 mt-1 max-h-48 w-56 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {matches.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center rounded-sm px-2 py-1.5 text-left',
                  i === highlight ? 'bg-accent text-accent-foreground' : 'hover:bg-accent'
                )}
                // onMouseDown (not onClick) so it fires before the input blur.
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectMatch(name)
                }}
              >
                @{name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
