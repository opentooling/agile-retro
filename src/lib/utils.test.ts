import { cn } from './utils'

describe('cn', () => {
    it('should merge class names correctly', () => {
        expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white')
    })

    it('should handle conditional classes', () => {
        const isTrue = true
        const isFalse = false
        expect(cn('base', isTrue && 'active', isFalse && 'inactive')).toBe('base active')
    })

    it('should resolve tailwind conflicts', () => {
        expect(cn('p-4', 'p-8')).toBe('p-8')
        expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
    })
})
