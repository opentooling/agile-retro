'use server'

import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'

function parseIntSafe(value: FormDataEntryValue | null): number | null {
    if (!value) return null;
    const stringValue = value.toString();
    if (!stringValue.trim()) return null;
    const parsed = parseInt(stringValue);
    return isNaN(parsed) ? null : parsed;
}

export async function createRetrospective(formData: FormData) {
    console.log("createRetrospective called")
    const title = formData.get('title') as string
    const tags = formData.get('tags') as string
    const creator = formData.get('creator') as string

    const inputDuration = parseIntSafe(formData.get('inputDuration'))
    const votingDuration = parseIntSafe(formData.get('votingDuration'))
    const reviewDuration = parseIntSafe(formData.get('reviewDuration'))
    const isAnonymous = formData.get('isAnonymous') === 'on'

    console.log("Data:", { title, tags, creator, inputDuration, votingDuration, reviewDuration, isAnonymous })

    if (!title || !title.trim()) {
        console.error("Title missing")
        throw new Error('Title is required')
    }

    try {
        const retro = await prisma.retrospective.create({
            data: {
                title: title.trim(),
                tags: tags || "",
                creator: creator || "Anonymous",
                inputDuration,
                votingDuration,
                reviewDuration,
                isAnonymous,
                phaseStartTime: new Date(), // Start input phase immediately
                columns: {
                    create: [
                        { title: 'What went well', type: 'WHAT_WENT_WELL' },
                        { title: 'What didn\'t go well', type: 'WHAT_DIDNT_GO_WELL' },
                        { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
                    ]
                }
            }
        })
        return retro
    } catch (error) {
        console.error("Prisma Error:", error)
        throw error
    }
}

export async function getUniqueTags() {
    const retros = await prisma.retrospective.findMany({
        select: { tags: true }
    })

    const allTags = retros
        .flatMap((r: { tags: string }) => r.tags.split(','))
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0)

    return Array.from(new Set(allTags)) as string[]
}

export async function getPopularTags() {
    const retros = await prisma.retrospective.findMany({
        select: { tags: true }
    })

    const tagCounts: Record<string, number> = {}

    retros.forEach((r: { tags: string }) => {
        if (!r.tags) return
        r.tags.split(',').forEach((t: string) => {
            const tag = t.trim()
            if (tag) {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1
            }
        })
    })

    return Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }))
}
