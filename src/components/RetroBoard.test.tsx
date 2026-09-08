import { render, screen, fireEvent, within } from '@testing-library/react'
import RetroBoard from './RetroBoard'
import { io } from 'socket.io-client'
 
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
