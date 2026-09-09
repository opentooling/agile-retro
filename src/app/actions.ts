'use server'

import * as db from '@/lib/db'
import type { Team } from '@/lib/db/types'
import { getPlugin } from '@/lib/plugins/registry'
import { pushActionDoneState } from '@/lib/jira-sync'
import { auth } from '@/auth'
import { authUserFromSession, isTeamAdmin, canViewBoard, canManageBoard, type RetroRef } from '@/lib/authz'
import { revalidatePath } from 'next/cache'
import { templateById } from '@/lib/retro-templates'
import { RETENTION_OPTIONS, expiryFromRetention } from '@/lib/retention'
import { purgeExpiredRetros } from '@/lib/purge'
import { buildInsights, type TeamInsights } from '@/lib/analytics'

/** Trim, drop empties and de-duplicate a list of group identifiers. */
function sanitizeGroups(groups: string[] | undefined): string[] {
    if (!Array.isArray(groups)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const g of groups) {
        const trimmed = String(g).trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(trimmed)
    }
    return out
}

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
    const blindInput = formData.get('blindInput') === 'on'
    // Optional retention ("TTL"): the board deletes itself this long after
    // creation. Absent or "never" keeps it indefinitely.
    const expiresAt = expiryFromRetention(formData.get('retentionDays')?.toString(), new Date())
    // The format decides the board's starting columns; unknown ids fall back to
    // the classic three-column layout.
    const template = templateById(formData.get('template')?.toString())

    console.log("Data:", { title, tags, creator, teamId, inputDuration, votingDuration, reviewDuration, isAnonymous })

    if (!title || !title.trim()) {
        console.error("Title missing")
        throw new Error('Title is required')
    }

    // Team is optional: a board may be aligned to a team (access-controlled) or
    // created without one ("open board", visible to any authenticated user).
    const normalizedTeamId = teamId && teamId.trim() ? teamId.trim() : null

    try {
        const retro = await db.createRetrospectiveWithColumns(
            {
                title: title.trim(),
                tags: tags || "",
                creator: creator || "Anonymous",
                teamId: normalizedTeamId,
                inputDuration,
                votingDuration,
                reviewDuration,
                isAnonymous,
                blindInput,
                expiresAt,
                phaseStartTime: new Date(), // Start input phase immediately
            },
            template.columns
        )
        revalidatePath('/')
        revalidatePath('/history')
        return retro
    } catch (error) {
        console.error("DB Error:", error)
        throw error
    }
}

export async function createTeam(
    name: string,
    groups?: { memberGroups?: string[]; adminGroups?: string[] }
): Promise<SafeTeam> {
    if (!name || !name.trim()) {
        throw new Error('Team name is required')
    }

    // The creator is recorded and treated as a team-admin so they can always
    // manage the team's boards, even before any access groups are configured.
    const authUser = authUserFromSession(await auth())

    try {
        const team = await db.createTeam(name.trim(), {
            createdBy: authUser?.id ?? null,
            memberGroups: sanitizeGroups(groups?.memberGroups),
            adminGroups: sanitizeGroups(groups?.adminGroups),
        })
        revalidatePath('/teams')
        revalidatePath('/')
        return sanitizeTeam(team)
    } catch (error) {
        console.error("Error creating team:", error)
        throw error
    }
}

/**
 * Update a team's access groups. Restricted to global admins and the team's own
 * team-admins (its creator or members of its admin groups), because whoever can
 * edit these bindings controls who can access the team's boards.
 */
export async function updateTeamGroups(
    id: string,
    memberGroups: string[],
    adminGroups: string[]
): Promise<SafeTeam> {
    if (!id) throw new Error('Team ID is required')

    const authUser = authUserFromSession(await auth())
    if (!authUser) throw new Error('Unauthorized')

    const existing = await db.getTeam(id)
    if (!existing) throw new Error('Team not found')

    const ref: RetroRef = { teamId: id, creator: '', team: existing }
    if (!authUser.isAdmin && !isTeamAdmin(authUser, ref)) {
        throw new Error('You are not allowed to edit this team\'s access groups')
    }

    const team = await db.updateTeamGroups(id, {
        memberGroups: sanitizeGroups(memberGroups),
        adminGroups: sanitizeGroups(adminGroups),
    })
    revalidatePath('/teams')
    revalidatePath('/')
    return sanitizeTeam(team)
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

/**
 * Set or clear a team's logo. The image is stored inline as a data URI, so it
 * must be a `data:image/*` value and reasonably small (large logos should be
 * resized client-side before upload). Pass null to remove.
 */
const MAX_TEAM_IMAGE_CHARS = 700_000 // ~500 KB once base64-encoded
export async function updateTeamImage(id: string, imageData: string | null): Promise<SafeTeam> {
    if (!id) throw new Error('Team ID is required')

    let value: string | null = null
    if (imageData) {
        if (!/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);/i.test(imageData)) {
            throw new Error('Image must be a PNG, JPEG, GIF, WEBP or SVG data URI')
        }
        if (imageData.length > MAX_TEAM_IMAGE_CHARS) {
            throw new Error('Image is too large — please use a smaller logo (under ~500 KB)')
        }
        value = imageData
    }

    const team = await db.updateTeamImage(id, value)
    revalidatePath('/teams')
    revalidatePath('/')
    return sanitizeTeam(team)
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

    if (!retro.teamId) throw new Error('This board is not aligned to a team, so external tasks cannot be created')

    const team = await db.getTeam(retro.teamId)
    if (!team) throw new Error('Team not found')

    const result = await plugin.createTaskForAction({ action, retro, team })
    await db.setActionExternalLink(actionId, { externalUrl: result.url, externalKey: result.key })

    // If the action is already done, reflect that on the freshly-created issue.
    if (action.completed) {
        await pushActionDoneState(actionId, true)
    }

    revalidatePath('/actions')
    revalidatePath(`/retro/${retro.id}`)
    return result
}

/**
 * Open action items carried over from a team's earlier retros.
 *
 * Retros lose their credibility when actions are agreed and then quietly
 * forgotten, so a board surfaces whatever its team still owes from last time.
 * Scoped to the board's own team and excluding the board itself; an open board
 * (no team) has no history to draw on and gets an empty list.
 *
 * Access is gated by the same policy as the board itself — these actions come
 * from the team's other boards, so anyone who can't view this one can't read
 * them either.
 */
export type CarriedAction = {
    id: string
    content: string
    assignee: string | null
    dueDate: string | null
    externalUrl: string | null
    externalKey: string | null
    retroId: string
    retroTitle: string
    retroCreatedAt: string
}

export async function getCarriedOverActions(retroId: string): Promise<CarriedAction[]> {
    if (!retroId) return []

    const retro = await db.getRetro(retroId)
    if (!retro?.teamId) return []

    const team = await db.getTeam(retro.teamId)
    const authUser = authUserFromSession(await auth())
    const ref: RetroRef = { teamId: retro.teamId, creator: retro.creator, team }
    if (!canViewBoard(authUser, ref)) return []

    const actions = await db.listActionItems({
        completed: false,
        teamId: retro.teamId,
        excludeRetrospectiveId: retroId,
    })

    return actions.map((a) => ({
        id: a.id,
        content: a.content,
        assignee: a.assignee,
        dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        externalUrl: a.externalUrl,
        externalKey: a.externalKey,
        retroId: a.retrospectiveId,
        retroTitle: a.retrospective.title,
        retroCreatedAt: a.retrospective.createdAt.toISOString(),
    }))
}

/** Mark a carried-over action done from the board that surfaced it. */
export async function completeCarriedOverAction(actionId: string, completed: boolean): Promise<void> {
    if (!actionId) throw new Error('Action id is required')

    const action = await db.getActionItem(actionId)
    if (!action) throw new Error('Action not found')

    const retro = await db.getRetro(action.retrospectiveId)
    if (!retro) throw new Error('Retrospective not found')

    const team = retro.teamId ? await db.getTeam(retro.teamId) : null
    const authUser = authUserFromSession(await auth())
    const ref: RetroRef = { teamId: retro.teamId, creator: retro.creator, team }
    if (!canViewBoard(authUser, ref)) throw new Error('Unauthorized')

    await db.updateActionCompleted(actionId, completed)
    await pushActionDoneState(actionId, completed)
    revalidatePath('/actions')
}

/**
 * Delete a board and everything on it.
 *
 * Restricted to the people who are already trusted to run the board: its
 * creator (the facilitator), a team-admin of its team, or a global admin.
 * Deliberately not open to participants — this destroys other people's
 * contributions and cannot be undone.
 */
export async function deleteRetrospective(retroId: string): Promise<void> {
    if (!retroId) throw new Error('Retrospective id is required')

    const retro = await db.getRetro(retroId)
    if (!retro) throw new Error('Retrospective not found')

    const team = retro.teamId ? await db.getTeam(retro.teamId) : null
    const authUser = authUserFromSession(await auth())
    const ref: RetroRef = { teamId: retro.teamId, creator: retro.creator, team }

    // canManageBoard is exactly this policy: facilitator, team-admin or admin.
    if (!canManageBoard(authUser, ref)) {
        throw new Error('Only the board creator, a team admin or an admin can delete this board')
    }

    await db.deleteRetro(retroId)
    revalidatePath('/')
    revalidatePath('/history')
    revalidatePath('/actions')
}

/**
 * Delete every board whose retention has elapsed. Safe to call repeatedly. The
 * sweep itself lives in lib/purge.ts so the Socket.IO server and the standalone
 * script can run it too, without a Next.js request context.
 */
export async function purgeExpiredRetrospectives(): Promise<number> {
    const deleted = await purgeExpiredRetros()
    if (deleted.length > 0) {
        revalidatePath('/')
        revalidatePath('/history')
        revalidatePath('/actions')
    }
    return deleted.length
}

/** Retention choices offered in the create dialog. */
export async function getRetentionOptions() {
    return RETENTION_OPTIONS
}

/**
 * Insights for one team.
 *
 * Gated by the same rule as the team's boards: if you can't open a board you
 * can't read the aggregates drawn from it. Returns null rather than throwing
 * when access is refused, so the page can say "pick another team" instead of
 * erroring.
 */
export async function getTeamInsights(teamId: string): Promise<TeamInsights | null> {
    if (!teamId) return null

    const team = await db.getTeam(teamId)
    if (!team) return null

    const authUser = authUserFromSession(await auth())
    // creator is empty: team access doesn't depend on any one board's creator.
    const ref: RetroRef = { teamId, creator: '', team }
    if (!canViewBoard(authUser, ref)) return null

    return buildInsights(await db.teamAnalytics(teamId))
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
