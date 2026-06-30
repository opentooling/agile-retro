'use server'

import * as db from '@/lib/db'
import type { Team } from '@/lib/db/types'
import { getPlugin } from '@/lib/plugins/registry'
import { revalidatePath } from 'next/cache'

/**
 * Remove secrets (the Jira API token) before a Team is sent to a client
 * component. Non-secret config (base URL, project key, email) is kept so the UI
 * can show whether the integration is configured.
 */
export type SafeTeam = Omit<Team, 'jiraApiToken'> & { jiraConfigured: boolean }

function sanitizeTeam(team: Team): SafeTeam {
    const { jiraApiToken, ...rest } = team
    return {
        ...rest,
        jiraConfigured: Boolean(team.jiraBaseUrl && team.jiraProjectKey && team.jiraEmail && jiraApiToken),
    }
}

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
    const teamId = formData.get('teamId') as string

    const inputDuration = parseIntSafe(formData.get('inputDuration'))
    const votingDuration = parseIntSafe(formData.get('votingDuration'))
    const reviewDuration = parseIntSafe(formData.get('reviewDuration'))
    const isAnonymous = formData.get('isAnonymous') === 'on'

    console.log("Data:", { title, tags, creator, teamId, inputDuration, votingDuration, reviewDuration, isAnonymous })

    if (!title || !title.trim()) {
        console.error("Title missing")
        throw new Error('Title is required')
    }

    if (!teamId || !teamId.trim()) {
        console.error("Team ID missing")
        throw new Error('Team is required')
    }

    try {
        const retro = await db.createRetrospectiveWithColumns(
            {
                title: title.trim(),
                tags: tags || "",
                creator: creator || "Anonymous",
                teamId: teamId,
                inputDuration,
                votingDuration,
                reviewDuration,
                isAnonymous,
                phaseStartTime: new Date(), // Start input phase immediately
            },
            [
                { title: 'What went well', type: 'WHAT_WENT_WELL' },
                { title: "What didn't go well", type: 'WHAT_DIDNT_GO_WELL' },
                { title: 'What should be improved', type: 'WHAT_SHOULD_BE_IMPROVED' },
            ]
        )
        revalidatePath('/')
        revalidatePath('/history')
        return retro
    } catch (error) {
        console.error("DB Error:", error)
        throw error
    }
}

export async function createTeam(name: string) {
    if (!name || !name.trim()) {
        throw new Error('Team name is required')
    }

    try {
        const team = await db.createTeam(name.trim())
        revalidatePath('/teams')
        revalidatePath('/')
        return team
    } catch (error) {
        console.error("Error creating team:", error)
        throw error
    }
}

export async function updateTeam(id: string, name: string) {
    if (!id) {
        throw new Error('Team ID is required')
    }
    if (!name || !name.trim()) {
        throw new Error('Team name is required')
    }

    try {
        const team = await db.updateTeam(id, name.trim())
        revalidatePath('/teams')
        revalidatePath('/')
        return team
    } catch (error) {
        console.error("Error updating team:", error)
        throw error
    }
}

export async function getTeams(): Promise<SafeTeam[]> {
    const teams = await db.listTeams()
    return teams.map(sanitizeTeam)
}

export async function updateTeamJira(
    id: string,
    config: { jiraBaseUrl: string; jiraProjectKey: string; jiraEmail: string; jiraApiToken: string }
): Promise<SafeTeam> {
    if (!id) throw new Error('Team ID is required')

    const norm = (v: string) => (v && v.trim() ? v.trim() : null)

    // If the token field is left blank on save, keep the existing stored token
    // (so users can edit other settings without re-entering the secret).
    let token = norm(config.jiraApiToken)
    if (token === null) {
        const existing = await db.getTeam(id)
        token = existing?.jiraApiToken ?? null
    }

    const team = await db.updateTeamJira(id, {
        jiraBaseUrl: norm(config.jiraBaseUrl),
        jiraProjectKey: norm(config.jiraProjectKey),
        jiraEmail: norm(config.jiraEmail),
        jiraApiToken: token,
    })
    revalidatePath('/teams')
    return sanitizeTeam(team)
}

/**
 * Run a plugin (e.g. "jira") to create an external task for an action item, and
 * persist the resulting link on the action. Returns the created link.
 */
export async function createExternalTaskForAction(
    actionId: string,
    pluginId: string
): Promise<{ url: string; key: string }> {
    const plugin = getPlugin(pluginId)
    if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`)

    const action = await db.getActionItem(actionId)
    if (!action) throw new Error('Action item not found')

    if (action.externalUrl && action.externalKey) {
        // Already linked — don't create a duplicate.
        return { url: action.externalUrl, key: action.externalKey }
    }

    const retro = await db.getRetro(action.retrospectiveId)
    if (!retro) throw new Error('Retrospective not found')

    const team = await db.getTeam(retro.teamId)
    if (!team) throw new Error('Team not found')

    const result = await plugin.createTaskForAction({ action, retro, team })
    await db.setActionExternalLink(actionId, { externalUrl: result.url, externalKey: result.key })

    revalidatePath('/actions')
    revalidatePath(`/retro/${retro.id}`)
    return result
}

export async function getUniqueTags() {
    const allTags = (await db.getAllTagStrings())
        .flatMap((tags: string) => tags.split(','))
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0)

    return Array.from(new Set(allTags)) as string[]
}

export async function getPopularTags() {
    const tagStrings = await db.getAllTagStrings()

    const tagCounts: Record<string, number> = {}

    tagStrings.forEach((tags: string) => {
        if (!tags) return
        tags.split(',').forEach((t: string) => {
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
