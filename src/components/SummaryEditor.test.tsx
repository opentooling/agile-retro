import { render, screen, fireEvent, act } from '@testing-library/react'
import { SummaryEditor } from './RetroBoard'

// RetroBoard pulls in server actions and dnd-kit at module load; stub them so
// this test can import the one component it cares about.
jest.mock('@/app/actions', () => ({
  createExternalTaskForAction: jest.fn(),
  getCarriedOverActions: jest.fn(() => Promise.resolve([])),
  completeCarriedOverAction: jest.fn(() => Promise.resolve()),
}))
jest.mock('socket.io-client', () => ({ io: jest.fn() }))
jest.mock('next/link', () => ({ children }: { children: React.ReactNode }) => children)
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSensor: jest.fn(),
  useSensors: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  closestCorners: jest.fn(),
}))
jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  arrayMove: jest.fn(),
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
}))
jest.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const field = () => screen.getByPlaceholderText('Notes from the discussion…') as HTMLTextAreaElement

describe('SummaryEditor', () => {
  it('debounces instead of sending every keystroke', () => {
    const onChange = jest.fn()
    render(<SummaryEditor value="" onChange={onChange} />)

    fireEvent.change(field(), { target: { value: 'perf' } })
    fireEvent.change(field(), { target: { value: 'perf regressed' } })
    expect(onChange).not.toHaveBeenCalled()

    act(() => { jest.advanceTimersByTime(500) })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('perf regressed')
  })

  it('keeps the caret where it is when the server echoes an update back', () => {
    // The bug: every keystroke was sent straight to the server, which broadcast
    // the board back and re-rendered this field from the incoming value —
    // dropping the caret to the end mid-sentence.
    const { rerender } = render(<SummaryEditor value="" onChange={jest.fn()} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'deploy was slow' } })

    // Put the caret back at a previous word, as if navigating to fix a typo.
    field().setSelectionRange(6, 6)

    // A broadcast lands while the field is focused, carrying the value as the
    // server last saw it — always a keystroke or more behind what's on screen.
    rerender(<SummaryEditor value="deploy was sl" onChange={jest.fn()} />)

    expect(field().value).toBe('deploy was slow')
    expect(field().selectionStart).toBe(6)
  })

  it('does not clobber an in-flight edit with a stale server value', () => {
    const { rerender } = render(<SummaryEditor value="" onChange={jest.fn()} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'local edit in progress' } })
    rerender(<SummaryEditor value="something older" onChange={jest.fn()} />)

    expect(field().value).toBe('local edit in progress')
  })

  it('adopts a remote change once the field is idle', () => {
    const { rerender } = render(<SummaryEditor value="first" onChange={jest.fn()} />)
    rerender(<SummaryEditor value="edited by someone else" onChange={jest.fn()} />)
    expect(field().value).toBe('edited by someone else')
  })

  it('flushes a pending edit immediately on blur', () => {
    const onChange = jest.fn()
    render(<SummaryEditor value="" onChange={onChange} />)

    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'done' } })
    fireEvent.blur(field())

    expect(onChange).toHaveBeenCalledWith('done')
  })

  it('renders read-only notes as text, and nothing at all when empty', () => {
    const { container, rerender } = render(<SummaryEditor value="" onChange={jest.fn()} readOnly />)
    expect(container).toBeEmptyDOMElement()

    rerender(<SummaryEditor value="line one\nline two" onChange={jest.fn()} readOnly />)
    expect(screen.queryByPlaceholderText('Notes from the discussion…')).toBeNull()
    expect(screen.getByText(/line one/)).toBeInTheDocument()
  })
})
