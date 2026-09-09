import { columnAccent } from './RetroBoard'
import { RETRO_TEMPLATES } from '@/lib/retro-templates'

jest.mock('@/app/actions', () => ({
  createExternalTaskForAction: jest.fn(),
  getCarriedOverActions: jest.fn(() => Promise.resolve([])),
  completeCarriedOverAction: jest.fn(() => Promise.resolve()),
  deleteRetrospective: jest.fn(),
}))
jest.mock('socket.io-client', () => ({ io: jest.fn() }))
jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => children)
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSensor: jest.fn(), useSensors: jest.fn(), PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(), closestCorners: jest.fn(),
}))
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: jest.fn(), transform: null, transition: null, isDragging: false }),
  arrayMove: jest.fn(), sortableKeyboardCoordinates: jest.fn(), verticalListSortingStrategy: jest.fn(),
}))
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

// Types resolved by name rather than by sentiment suffix.
const EXPLICIT_TYPES = [
  'START', 'STOP', 'CONTINUE',
  'WHAT_WENT_WELL', 'WHAT_DIDNT_GO_WELL', 'WHAT_SHOULD_BE_IMPROVED',
]
const SUFFIXES = ['_POSITIVE', '_NEGATIVE', '_IMPROVE', '_RISK', '_NEUTRAL']

describe('columnAccent', () => {
  it('resolves every shipped column type deliberately, not by accident', () => {
    // The review phase pools items from all columns, so the accent is the only
    // thing saying which column an item came from. A column type that matches
    // neither an explicit name nor a sentiment suffix — a typo like
    // "_POSITVE", say — still *renders*, silently grey, which is why this
    // checks the type is recognised rather than just that a colour came back.
    const unrecognised: string[] = []
    for (const template of RETRO_TEMPLATES) {
      for (const { type } of template.columns) {
        const known = EXPLICIT_TYPES.includes(type) || SUFFIXES.some((sfx) => type.endsWith(sfx))
        if (!known) unrecognised.push(`${template.id}/${type}`)
      }
    }
    expect(unrecognised).toEqual([])
  })

  it('allows at most one deliberately neutral column per template', () => {
    // "Learned" in 4Ls is genuinely neutral; two greys in one template means
    // something fell through instead.
    const neutral = columnAccent('X_NEUTRAL').border
    for (const template of RETRO_TEMPLATES) {
      const greys = template.columns.filter((c) => columnAccent(c.type).border === neutral)
      expect(greys.length).toBeLessThanOrEqual(1)
    }
  })

  it('distinguishes the columns within each template', () => {
    for (const template of RETRO_TEMPLATES) {
      const borders = template.columns.map((c) => columnAccent(c.type).border)
      expect(new Set(borders).size).toBe(template.columns.length)
    }
  })

  it('maps sentiment suffixes without needing a per-type entry', () => {
    expect(columnAccent('ANYTHING_POSITIVE').border).toBe(columnAccent('WHAT_WENT_WELL').border)
    expect(columnAccent('ANYTHING_NEGATIVE').border).toBe(columnAccent('WHAT_DIDNT_GO_WELL').border)
    expect(columnAccent('ANYTHING_IMPROVE').border).toBe(columnAccent('WHAT_SHOULD_BE_IMPROVED').border)
    expect(columnAccent('ANYTHING_RISK').border).toContain('amber')
  })

  it('falls back to a neutral accent for an unknown type', () => {
    expect(columnAccent('MYSTERY').border).toContain('slate')
  })
})
