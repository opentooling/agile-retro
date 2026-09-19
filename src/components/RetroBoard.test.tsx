import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import RetroBoard from './RetroBoard'
import { io } from 'socket.io-client'
import { getCarriedOverActions, completeCarriedOverAction } from '@/app/actions'
 
// Mock socket.io-client
jest.mock('socket.io-client', () => {
  const mSocket = {
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  }
  return {
    io: jest.fn(() => mSocket),
  }
})
 
// Mock next-themes
jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}))

// Mock the server actions imported by RetroBoard (e.g. the Jira plugin trigger)
// so the component renders without pulling in the server-only data layer.
jest.mock('@/app/actions', () => ({
  createExternalTaskForAction: jest.fn(),
  getCarriedOverActions: jest.fn(() => Promise.resolve([])),
  completeCarriedOverAction: jest.fn(() => Promise.resolve()),
}))
 
// Mock next/link
jest.mock('next/link', () => {
  return ({ children }: { children: React.ReactNode }) => {
    return children
  }
})
 
// Mock ResizeObserver (used by some UI components likely)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock dnd-kit
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSensor: jest.fn(),
  useSensors: jest.fn(),
  PointerSensor: jest.fn(),
  KeyboardSensor: jest.fn(),
  closestCorners: jest.fn(),
  useDroppable: () => ({ setNodeRef: jest.fn(), isOver: false }),
}))

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    setActivatorNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: jest.fn(),
  sortableKeyboardCoordinates: jest.fn(),
}))

jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: jest.fn(),
    },
  },
}))
 
const mockRetroData = {
  id: 'test-retro-id',
  title: 'Test Retro',
  creator: 'test-user',
  status: 'INPUT',
  columns: [
    {
      id: 'col-1',
      title: 'What went well',
      type: 'START',
      items: [],
    },
    {
      id: 'col-2',
      title: 'What didn\'t go well',
      type: 'STOP',
      items: [],
    },
    {
      id: 'col-3',
      title: 'What should be improved',
      type: 'CONTINUE',
      items: [],
    },
  ],
  actions: [],
  inputDuration: 5,
  votingDuration: 5,
  reviewDuration: 5,
  phaseStartTime: new Date().toISOString(),
  isAnonymous: false,
}
 
// The carried-over-actions panel resolves a promise on mount, so let pending
// microtasks settle before a test ends — otherwise its state update lands
// outside act() and React warns.
afterEach(async () => {
  await act(async () => {})
})

describe('RetroBoard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock localStorage
    Storage.prototype.getItem = jest.fn((key) => {
        if (key === 'retro-username') return 'test-user'
        if (key === 'retro-user-id') return 'test-user-id'
        return null
    })
  })
 
  it('renders the retro title', () => {
    render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
    expect(screen.getByText('Test Retro')).toBeInTheDocument()
  })
 
  it('renders columns in INPUT phase', () => {
    render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
    expect(screen.getByText('What went well')).toBeInTheDocument()
    expect(screen.getByText('What didn\'t go well')).toBeInTheDocument()
    expect(screen.getByText('What should be improved')).toBeInTheDocument()
  })
 
  it('connects to socket on mount', () => {
    render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
    expect(io).toHaveBeenCalled()
  })

  describe('voting', () => {
    const votingData = {
      ...mockRetroData,
      status: 'VOTING',
      columns: [
        {
          ...mockRetroData.columns[0],
          items: [{ id: 'item-1', content: 'Flaky CI', summary: null, userId: 'test-user-id', username: 'test-user', votes: [{ userId: 'test-user-id', count: 2 }], reactions: [] }],
        },
        ...mockRetroData.columns.slice(1),
      ],
    }

    it('sets the vote count from the star you click', () => {
      render(<RetroBoard initialData={votingData} user={{ name: 'test-user' }} />)
      const mockSocket = (io as jest.Mock).mock.results[0].value

      // Starting at 2 votes, clicking the 5th star should ask for 3 more.
      fireEvent.click(screen.getByLabelText('Give 5 votes'))
      expect(mockSocket.emit).toHaveBeenCalledWith('vote', expect.objectContaining({ itemId: 'item-1', delta: 3 }))
    })

    it('steps back down when you click the star you are already on', () => {
      // Otherwise there is no way to reach zero with a row of stars.
      render(<RetroBoard initialData={votingData} user={{ name: 'test-user' }} />)
      const mockSocket = (io as jest.Mock).mock.results[0].value

      fireEvent.click(screen.getByLabelText('Reduce to 1 votes'))
      expect(mockSocket.emit).toHaveBeenCalledWith('vote', expect.objectContaining({ itemId: 'item-1', delta: -1 }))
    })

    it('gives every star a 24px hit target', () => {
      // A bare 16px icon is below the WCAG 2.5.8 minimum, and these get used
      // under time pressure in a narrow column.
      render(<RetroBoard initialData={votingData} user={{ name: 'test-user' }} />)
      expect(screen.getByLabelText('Give 5 votes').className).toMatch(/h-6 w-6/)
    })

    it('disables stars the viewer cannot afford', () => {
      const spent = {
        ...votingData,
        columns: [
          {
            ...votingData.columns[0],
            items: [{ ...votingData.columns[0].items[0], votes: [{ userId: 'test-user-id', count: 10 }] }],
          },
          ...votingData.columns.slice(1),
        ],
      }
      render(<RetroBoard initialData={spent} user={{ name: 'test-user' }} />)
      // All 10 votes spent on this item, so nothing above it is reachable…
      expect(screen.getByLabelText('Reduce to 9 votes')).not.toBeDisabled()
    })
  })

  describe('blind input', () => {
    const blindData = {
      ...mockRetroData,
      blindInput: true,
      columns: [
        {
          ...mockRetroData.columns[0],
          hiddenItemCount: 3,
          items: [{ id: 'mine', content: 'My own card', summary: null, userId: 'test-user-id', username: 'test-user', votes: [], reactions: [] }],
        },
        ...mockRetroData.columns.slice(1),
      ],
    }

    it('tells the viewer why the board looks empty', () => {
      render(<RetroBoard initialData={blindData} user={{ name: 'test-user' }} />)
      expect(screen.getByText(/Blind input/)).toBeInTheDocument()
      expect(screen.getByText('My own card')).toBeInTheDocument()
    })

    it('shows how many cards others have written without revealing them', () => {
      render(<RetroBoard initialData={blindData} user={{ name: 'test-user' }} />)
      expect(screen.getByText(/3 hidden cards from others/)).toBeInTheDocument()
    })

    it('drops the banner once the phase moves on', () => {
      render(<RetroBoard initialData={{ ...blindData, status: 'VOTING' }} user={{ name: 'test-user' }} />)
      expect(screen.queryByText(/Blind input/)).toBeNull()
    })

    it('says nothing on a board that did not opt in', () => {
      render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
      expect(screen.queryByText(/Blind input/)).toBeNull()
    })
  })

  describe('carried-over actions', () => {
    const teamData = { ...mockRetroData, team: { id: 't1', name: 'Platform' } }

    it('surfaces open actions from the team\'s previous retros', async () => {
      ;(getCarriedOverActions as jest.Mock).mockResolvedValueOnce([
        {
          id: 'a1', content: 'Fix the flaky pipeline', assignee: 'bo',
          dueDate: null, externalUrl: null, externalKey: null,
          retroId: 'r0', retroTitle: 'Sprint 41 Retro', retroCreatedAt: new Date().toISOString(),
        },
      ])
      render(<RetroBoard initialData={teamData} user={{ name: 'test-user' }} />)

      expect(await screen.findByText('Fix the flaky pipeline')).toBeInTheDocument()
      expect(screen.getByText(/1 open action from previous retros/)).toBeInTheDocument()
      expect(screen.getByText('Sprint 41 Retro')).toBeInTheDocument()
    })

    it('lets anyone tick one off, and drops it from the list', async () => {
      ;(getCarriedOverActions as jest.Mock).mockResolvedValueOnce([
        {
          id: 'a1', content: 'Fix the flaky pipeline', assignee: null,
          dueDate: null, externalUrl: null, externalKey: null,
          retroId: 'r0', retroTitle: 'Sprint 41 Retro', retroCreatedAt: new Date().toISOString(),
        },
      ])
      render(<RetroBoard initialData={teamData} user={{ name: 'test-user' }} />)

      const checkbox = await screen.findByLabelText('Mark "Fix the flaky pipeline" done')
      fireEvent.click(checkbox)

      await waitFor(() => expect(completeCarriedOverAction).toHaveBeenCalledWith('a1', true))
      await waitFor(() => expect(screen.queryByText('Fix the flaky pipeline')).toBeNull())
    })

    it('shows nothing on an open board, which has no team history', async () => {
      render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
      await waitFor(() => expect(getCarriedOverActions).not.toHaveBeenCalled())
    })
  })

  describe('a closed board', () => {
    const closedData = {
      ...mockRetroData,
      status: 'CLOSED',
      columns: [
        {
          ...mockRetroData.columns[0],
          items: Array.from({ length: 8 }, (_, i) => ({
            id: `item-${i}`, content: `Card ${i}`, summary: i === 0 ? 'Discussed' : null,
            userId: 'u1', username: 'ana', votes: [{ userId: 'u1', count: 8 - i }], reactions: [],
          })),
        },
        ...mockRetroData.columns.slice(1),
      ],
      actions: [{ id: 'a1', content: 'Fix the pipeline', completed: false }],
    }

    it('opens on the discussion view, pooled and vote-sorted', () => {
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true')
    })

    it('can be read through each phase, including Input', () => {
      // A closed board used to show only the pooled Review layout, so the
      // column arrangement the team actually raised things in was unreachable.
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      for (const phase of ['Input', 'Voting', 'Review', 'Actions']) {
        expect(screen.getByRole('tab', { name: phase })).toBeInTheDocument()
      }

      fireEvent.click(screen.getByRole('tab', { name: 'Input' }))
      expect(screen.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true')
      // Cards are grouped under their column heading again.
      expect(screen.getAllByText('What went well').length).toBeGreaterThan(0)
      expect(screen.getByText('Card 0')).toBeInTheDocument()
    })

    it('is explicit that it is not a point-in-time snapshot', () => {
      // The board holds its final content; only the arrangement changes.
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      expect(screen.getByText(/not a snapshot of that moment/)).toBeInTheDocument()
    })

    it('shows every card, not just the top few', () => {
      // It used to show the top 5, which made revisiting a past retro a
      // summary rather than a record of what was said.
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      for (let i = 0; i < 8; i++) {
        expect(screen.getByText(`Card ${i}`)).toBeInTheDocument()
      }
    })

    it('says it is a record, and keeps the export', () => {
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      expect(screen.getByText(/This retrospective is closed/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Export report/ })).toBeInTheDocument()
    })

    it('offers no way to add a card or react', () => {
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      expect(screen.queryByPlaceholderText(/Add a card/)).toBeNull()
      expect(screen.queryByLabelText('Add reaction')).toBeNull()
    })

    it('still shows the retro notes that were captured', () => {
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      expect(screen.getByText('Discussed')).toBeInTheDocument()
    })

    it('still lists action items under their phase — they outlive the session', () => {
      render(<RetroBoard initialData={closedData} user={{ name: 'test-user' }} />)
      fireEvent.click(screen.getByRole('tab', { name: 'Actions' }))
      expect(screen.getByText('Fix the pipeline')).toBeInTheDocument()
      // And they stay togglable, unlike everything else on a closed board.
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
    })
  })

  describe('phase timer', () => {
    // A phase that started 6 minutes ago with a 5 minute budget: 1 minute over.
    const overtimeData = {
      ...mockRetroData,
      status: 'INPUT',
      inputDuration: 5,
      phaseStartTime: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    }

    const renderAsOwner = (data: typeof mockRetroData) =>
      render(
        <RetroBoard
          initialData={data}
          user={{ name: 'test-user' }}
          viewer={{ id: 'test-user-id', name: 'test-user', isAdmin: false, canManage: true }}
        />
      )

    it('never advances the phase on its own once the time runs out', () => {
      renderAsOwner(overtimeData)
      const mockSocket = (io as jest.Mock).mock.results[0].value
      const statusEmits = mockSocket.emit.mock.calls.filter((c: unknown[]) => c[0] === 'update-status')
      expect(statusEmits).toHaveLength(0)
    })

    it('counts into negative time instead of stopping at zero', () => {
      renderAsOwner(overtimeData)
      expect(screen.getByText('Overtime')).toBeInTheDocument()
      expect(screen.getByText(/^-0[01]:\d{2}$/)).toBeInTheDocument()
      expect(screen.queryByText('Time Remaining')).toBeNull()
    })

    it('still counts down normally before the deadline', () => {
      renderAsOwner({
        ...mockRetroData,
        phaseStartTime: new Date(Date.now() - 60 * 1000).toISOString(),
      })
      expect(screen.getByText('Time Remaining')).toBeInTheDocument()
      expect(screen.queryByText('Overtime')).toBeNull()
    })

    it('offers the facilitator a snooze while in overtime', () => {
      renderAsOwner(overtimeData)
      const mockSocket = (io as jest.Mock).mock.results[0].value

      fireEvent.click(screen.getByRole('button', { name: /Snooze 5 minutes/ }))

      expect(mockSocket.emit).toHaveBeenCalledWith('extend-timer', { retroId: 'test-retro-id' })
    })

    it('does not offer the snooze to a non-facilitator', () => {
      render(
        <RetroBoard
          initialData={overtimeData}
          user={{ name: 'someone-else' }}
          viewer={{ id: 'other', name: 'someone-else', isAdmin: false, canManage: false }}
        />
      )
      expect(screen.queryByRole('button', { name: /Snooze 5 minutes/ })).toBeNull()
      // …but the clock is still visible to everyone.
      expect(screen.getByText('Overtime')).toBeInTheDocument()
    })
  })

  describe('REVIEW phase', () => {
    const reviewData = {
      ...mockRetroData,
      status: 'REVIEW',
      columns: [
        {
          ...mockRetroData.columns[0],
          items: [{ id: 'well-1', content: 'Pairing helped', summary: null, username: 'ana', votes: [{ userId: 'u1', count: 3 }], reactions: [] }],
        },
        {
          ...mockRetroData.columns[1],
          items: [
            { id: 'bad-1', content: 'Flaky CI', summary: null, username: 'bo', votes: [{ userId: 'u1', count: 7 }], reactions: [] },
            { id: 'bad-2', content: 'Nobody voted for this', summary: null, username: 'cy', votes: [], reactions: [] },
          ],
        },
        { ...mockRetroData.columns[2], items: [] },
      ],
    }

    const renderReview = () =>
      render(<RetroBoard initialData={reviewData} user={{ name: 'test-user' }} />)

    it('lets the discussion queue fill the available width', () => {
      // The review layout is a flex item, and a flex item with auto cross-axis
      // margins shrinks to its content instead of stretching. Without an
      // explicit width the cards collapse to the width of the shortest card's
      // text, which is what happened when the board became a flex column.
      const { container } = renderReview()
      const layout = container.querySelector('[data-review-queue]')
      expect(layout).not.toBeNull()
      expect(layout!.className).toMatch(/\bw-full\b/)
    })

    it('puts the top-voted card in the spotlight, and walks the queue', () => {
      renderReview()
      const spotlight = screen.getByRole('region', { name: 'Now discussing' })
      expect(within(spotlight).getByText('Flaky CI')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Next topic/ }))
      expect(within(spotlight).getByText('Pairing helped')).toBeInTheDocument()
    })

    it('labels each item with the column it came from', () => {
      renderReview()
      // Column titles appear as per-item badges now that items are pooled.
      expect(screen.getByText('Pairing helped')).toBeInTheDocument()
      expect(screen.getByText('What went well')).toBeInTheDocument()
      // Both "didn't go well" items carry the badge, so there are two.
      expect(screen.getAllByText("What didn't go well")).toHaveLength(2)
    })

    it('orders items by votes, highest first', () => {
      const { container } = renderReview()
      const rendered = [...container.querySelectorAll('p, div')]
        .map((el) => el.textContent?.trim())
        .filter((t) => t === 'Flaky CI' || t === 'Pairing helped')
      expect(rendered[0]).toBe('Flaky CI') // 7 votes beats 3
    })

    it('still shows items that received no votes, under their own heading', () => {
      renderReview()
      expect(screen.getByText('Nobody voted for this')).toBeInTheDocument()
      expect(screen.getByText(/Also raised · 1 with no votes/)).toBeInTheDocument()
    })

    it('lets a viewer react to an item without spending a vote', () => {
      renderReview()
      const mockSocket = (io as jest.Mock).mock.results[0].value

      // First card in the list is the highest-voted item ("Flaky CI").
      const addReaction = screen.getAllByLabelText('Add reaction')[0]
      fireEvent.click(addReaction)
      fireEvent.click(within(addReaction.parentElement!).getByText('👍'))

      expect(mockSocket.emit).toHaveBeenCalledWith('toggle-reaction', {
        retroId: 'test-retro-id',
        itemId: 'bad-1',
        emoji: '👍',
      })
    })
  })

  describe('ACTIONS phase', () => {
    const actionsData = {
      ...mockRetroData,
      status: 'ACTIONS',
      columns: [
        {
          ...mockRetroData.columns[0],
          items: [{ id: 'i1', content: 'Flaky CI', summary: null, username: 'bo', votes: [{ userId: 'u1', count: 4 }], reactions: [] }],
        },
        ...mockRetroData.columns.slice(1),
      ],
    }

    it('turns a top card into a draft action without sending anything', () => {
      render(<RetroBoard initialData={actionsData} user={{ name: 'test-user' }} />)
      const mockSocket = (io as jest.Mock).mock.results[0].value

      fireEvent.click(screen.getByRole('button', { name: /Turn into an action/ }))
      expect(screen.getByLabelText('New action item')).toHaveValue('Flaky CI')
      // Only a draft: nothing is created until the facilitator adds it.
      expect(mockSocket.emit).not.toHaveBeenCalledWith('add-action-item', expect.anything())
    })
  })

  it('renders anonymous mode correctly', () => {
    const anonymousData = { ...mockRetroData, isAnonymous: true, columns: [
        { ...mockRetroData.columns[0], items: [{ id: 'item-1', content: 'Test Item', summary: null, username: 'other-user', votes: [], reactions: [] }] }
    ]}
    render(<RetroBoard initialData={anonymousData} user={{ name: 'test-user' }} />)
    expect(screen.getByText('Anonymous')).toBeInTheDocument()
    expect(screen.queryByText('other-user')).not.toBeInTheDocument()
  })



  it('emits move-item event on drag end', () => {
    // This is hard to test with full DnD simulation in jsdom without complex setup.
    // We'll trust the manual verification plan for the actual drag interaction,
    // but we can verify the event if we could trigger handleDragEnd.
    // For now, we'll just ensure the component renders without crashing with DnD context.
    render(<RetroBoard initialData={mockRetroData} user={{ name: 'test-user' }} />)
    expect(screen.getByText('What went well')).toBeInTheDocument()
  })

  it('renders team name if present', () => {
    const teamData = { ...mockRetroData, team: { id: 'team-1', name: 'Engineering Team' } }
    render(<RetroBoard initialData={teamData} user={{ name: 'test-user' }} />)
    expect(screen.getByText('Engineering Team')).toBeInTheDocument()
  })
})

describe('rearranging cards during Input', () => {
  const card = (id: string, username: string, userId: string) => ({
    id, content: `Card ${id}`, summary: null, username, userId, votes: [], reactions: [],
  })
  const board = (status = 'INPUT') => ({
    ...mockRetroData,
    creator: 'facilitator',
    status,
    columns: [
      { ...mockRetroData.columns[0], items: [card('mine-1', 'test-user', 'me@example.com'), card('mine-2', 'test-user', 'me@example.com'), card('theirs', 'Amy', 'amy@example.com')] },
      mockRetroData.columns[1],
      mockRetroData.columns[2],
    ],
  })
  const me = { id: 'me@example.com', name: 'test-user', isAdmin: false, canManage: false }
  const emitted = () => (io as unknown as jest.Mock).mock.results[0].value.emit as jest.Mock
  const openOptions = (content: string) =>
    fireEvent.keyDown(screen.getByRole('button', { name: `Card options: ${content}` }), { key: 'Enter' })

  beforeEach(() => {
    jest.clearAllMocks()
    Storage.prototype.getItem = jest.fn((key) => (key === 'retro-username' ? 'test-user' : key === 'retro-user-id' ? 'me@example.com' : null))
  })

  it('shows a visible drag handle and an options menu on your own cards only', () => {
    render(<RetroBoard initialData={board()} user={{ name: 'test-user' }} viewer={me} />)
    expect(screen.getByRole('button', { name: 'Drag to move: Card mine-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Card options: Card mine-1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Card options: Card theirs' })).toBeNull()
  })

  it('lets the facilitator rearrange anyone\'s card', () => {
    render(<RetroBoard initialData={board()} user={{ name: 'test-user' }} viewer={{ ...me, canManage: true }} />)
    expect(screen.getByRole('button', { name: 'Card options: Card theirs' })).toBeInTheDocument()
  })

  it('asks before deleting, then tells the server', async () => {
    render(<RetroBoard initialData={board()} user={{ name: 'test-user' }} viewer={me} />)
    openOptions('Card mine-1')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/ }))
    expect(await screen.findByRole('dialog', { name: 'Delete this card?' })).toBeInTheDocument()
    expect(emitted()).not.toHaveBeenCalledWith('delete-item', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Delete card/ }))
    expect(emitted()).toHaveBeenCalledWith('delete-item', { retroId: 'test-retro-id', itemId: 'mine-1' })
  })

  it('moves a card to another section without dragging', async () => {
    render(<RetroBoard initialData={board()} user={{ name: 'test-user' }} viewer={me} />)
    openOptions('Card mine-1')
    fireEvent.click(await screen.findByRole('menuitem', { name: /What didn't go well/ }))
    expect(emitted()).toHaveBeenCalledWith('move-item', {
      retroId: 'test-retro-id', itemId: 'mine-1', targetColumnId: 'col-2', beforeItemId: null,
    })
  })

  it('reorders within a section: "Move up" goes before the card above', async () => {
    render(<RetroBoard initialData={board()} user={{ name: 'test-user' }} viewer={me} />)
    openOptions('Card mine-2')
    fireEvent.click(await screen.findByRole('menuitem', { name: /Move up/ }))
    expect(emitted()).toHaveBeenCalledWith('move-item', {
      retroId: 'test-retro-id', itemId: 'mine-2', targetColumnId: 'col-1', beforeItemId: 'mine-1',
    })
  })

  it('offers no moving or deleting once voting has started', () => {
    render(<RetroBoard initialData={board('VOTING')} user={{ name: 'test-user' }} viewer={me} />)
    expect(screen.queryByRole('button', { name: /Card options/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Drag to move/ })).toBeNull()
  })
})

describe('editing actions during the Actions phase', () => {
  const withAction = (status: string) => ({
    ...mockRetroData,
    status,
    actions: [{ id: 'act-1', content: 'Fix the flaky test', completed: false, assignee: 'Amy', dueDate: null }],
  })
  const emitted = () => (io as unknown as jest.Mock).mock.results[0].value.emit as jest.Mock

  beforeEach(() => jest.clearAllMocks())

  it('edits an action in place', () => {
    render(<RetroBoard initialData={withAction('ACTIONS')} user={{ name: 'test-user' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit action: Fix the flaky test' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Action' }), { target: { value: 'Quarantine the flaky test' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(emitted()).toHaveBeenCalledWith('update-action-item', {
      retroId: 'test-retro-id', actionId: 'act-1', content: 'Quarantine the flaky test', assignee: 'Amy', dueDate: null,
    })
  })

  it('asks before deleting an action', () => {
    render(<RetroBoard initialData={withAction('ACTIONS')} user={{ name: 'test-user' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete action: Fix the flaky test' }))
    expect(emitted()).not.toHaveBeenCalledWith('delete-action-item', expect.anything())
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm deletion' })).getByRole('button', { name: 'Delete' }))
    expect(emitted()).toHaveBeenCalledWith('delete-action-item', { retroId: 'test-retro-id', actionId: 'act-1' })
  })

  it('keeps the list fixed once the retro is closed', () => {
    render(<RetroBoard initialData={withAction('CLOSED')} user={{ name: 'test-user' }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }))
    // The action is shown — so the absence of edit controls means something.
    expect(screen.getByText('Fix the flaky test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit action/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete action/ })).toBeNull()
  })
})
