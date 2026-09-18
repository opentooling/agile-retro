'use client'

import { useState, useEffect, useRef } from 'react'
import { createTeam, getTeamDirectory, updateTeam, updateTeamJira, updateTeamGroups, updateTeamImage } from '@/app/actions'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Users, Plus, CheckCircle, AlertCircle, Pencil, Link2, Shield, ImagePlus, Trash2, Lock, Settings2, ChevronDown, Building2 } from 'lucide-react'
import { TeamMark } from '@/components/TeamMark'
import { CreateRetroDialog } from "@/components/CreateRetroDialog"
import { useSearchParams } from 'next/navigation'
import { GroupsField, useKeycloakGroups } from "@/components/GroupsField"
import { PageShell } from "@/components/PageHeader"
import { Masthead, SectionTitle } from "@/components/Masthead"
import { ScopeBar } from "@/components/ScopeBar"
import { EmptyState } from "@/components/visual/EmptyState"
import { EmptyBoard } from "@/components/visual/Illustration"
import { cn } from "@/lib/utils"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"

type Team = {
    id: string
    name: string
    createdAt: Date
    // 'none' means the viewer can see that this team exists and nothing more:
    // the server sends no groups, no Jira config and no creator for it.
    access: 'admin' | 'member' | 'none'
    createdBy?: string | null
    memberGroups?: string[]
    adminGroups?: string[]
    imageData?: string | null
    jiraBaseUrl?: string | null
    jiraProjectKey?: string | null
    jiraEmail?: string | null
    jiraConfigured?: boolean
}

export default function TeamsPage() {
    const [teams, setTeams] = useState<Team[]>([])
    const [newTeamName, setNewTeamName] = useState('')
    const [newMemberGroups, setNewMemberGroups] = useState<string[]>([])
    const [newAdminGroups, setNewAdminGroups] = useState<string[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [createOpen, setCreateOpen] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const groupSuggestions = useKeycloakGroups()
    const searchParams = useSearchParams()
    const teamFilter = searchParams.get('teamId')

    useEffect(() => {
        loadTeams()
    }, [teamFilter])

    async function loadTeams() {
        try {
            const loadedTeams = await getTeamDirectory()
            if (teamFilter) {
                setTeams(loadedTeams.filter(t => t.name.toLowerCase().includes(teamFilter.toLowerCase())))
            } else {
                setTeams(loadedTeams)
            }
        } catch (error) {
            console.error("Failed to load teams", error)
        }
    }

    async function handleCreateTeam(e: React.FormEvent) {
        e.preventDefault()
        if (!newTeamName.trim()) return

        setIsLoading(true)
        setMessage(null)

        try {
            await createTeam(newTeamName, { memberGroups: newMemberGroups, adminGroups: newAdminGroups })
            setNewTeamName('')
            setNewMemberGroups([])
            setNewAdminGroups([])
            setMessage({ type: 'success', text: 'Team created successfully' })
            setCreateOpen(false)
            loadTeams()
            // Dispatch event to update sidebar
            window.dispatchEvent(new Event('team-updated'))
            setTimeout(() => setMessage(null), 3000)
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to create team' })
        } finally {
            setIsLoading(false)
        }
    }

    const mine = teams.filter((t) => t.access !== 'none')
    const others = teams.filter((t) => t.access === 'none')
    const renderTeam = (team: Team) => (
        <TeamRow
            key={team.id}
            team={team}
            groupSuggestions={groupSuggestions}
            onUpdate={() => {
                loadTeams()
                setMessage({ type: 'success', text: 'Team updated successfully' })
                window.dispatchEvent(new Event('team-updated'))
                setTimeout(() => setMessage(null), 3000)
            }}
        />
    )

    return (
        <PageShell width="wide">
            <Masthead
                eyebrow="Organisation"
                icon={Building2}
                title="Teams"
                lede="Who can open which boards. Access comes from your identity provider's groups."
                actions={
                    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2"><Plus className="h-4 w-4" /> New team</Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[520px]">
                            <DialogHeader>
                                <DialogTitle>Create team</DialogTitle>
                                <DialogDescription>
                                    Teams control who can open a board. Groups come from your identity
                                    provider (e.g. AD/Keycloak); leave them empty to restrict the team to
                                    global admins for now — you can change them later.
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleCreateTeam} className="flex flex-col gap-4">
                                <div className="flex flex-col gap-1.5">
                                    <Label htmlFor="new-team-name">Name</Label>
                                    <Input
                                        id="new-team-name"
                                        placeholder="e.g. Engineering, Design"
                                        value={newTeamName}
                                        onChange={(e) => setNewTeamName(e.target.value)}
                                    />
                                </div>
                                <GroupsField
                                    label="Member groups (view & participate)"
                                    value={newMemberGroups}
                                    onChange={setNewMemberGroups}
                                    suggestions={groupSuggestions.groups}
                                    datalistId="new-team-member-groups"
                                    placeholder={groupSuggestions.configured ? 'Search groups…' : 'e.g. /Eng/Platform'}
                                />
                                <GroupsField
                                    label="Admin groups (manage boards)"
                                    value={newAdminGroups}
                                    onChange={setNewAdminGroups}
                                    suggestions={groupSuggestions.groups}
                                    datalistId="new-team-admin-groups"
                                    placeholder={groupSuggestions.configured ? 'Search groups…' : 'e.g. /Eng/Platform/Admins'}
                                />
                                <DialogFooter>
                                    <Button type="submit" disabled={isLoading || !newTeamName.trim()}>
                                        {isLoading ? 'Creating…' : 'Create team'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                }
            />

            <ScopeBar fields={['team']} />

            {message && (
                <div
                    role="status"
                    className={cn(
                        'mb-6 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium',
                        message.type === 'success'
                            ? 'bg-[hsl(var(--tone-positive-soft))] text-[hsl(var(--tone-positive-ink))]'
                            : 'bg-[hsl(var(--tone-negative-soft))] text-[hsl(var(--tone-negative-ink))]',
                    )}
                >
                    {message.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    {message.text}
                </div>
            )}

            {teams.length === 0 ? (
                <EmptyState
                    illustration={<EmptyBoard className="h-24 w-40" />}
                    title="No teams found."
                    hint="Create one to get started, or clear the filter."
                />
            ) : (
                <div className="@container space-y-10">
                    {mine.length > 0 && (
                        <section aria-labelledby="my-teams">
                            <SectionTitle id="my-teams" aside={<span className="text-muted-foreground">{mine.length}</span>}>
                                Your teams
                            </SectionTitle>
                            <ul className="grid gap-3 @min-[80rem]:grid-cols-2">{mine.map(renderTeam)}</ul>
                        </section>
                    )}
                    {others.length > 0 && (
                        <section aria-labelledby="other-teams">
                            <SectionTitle id="other-teams" aside={<span className="text-muted-foreground">{others.length}</span>}>
                                Other teams
                            </SectionTitle>
                            <p className="-mt-1 mb-3 text-sm text-muted-foreground">
                                Listed so you know they exist and who to ask — you can&apos;t open their boards.
                            </p>
                            <ul className="grid gap-2 @2xl:grid-cols-2 @min-[80rem]:grid-cols-3">{others.map(renderTeam)}</ul>
                        </section>
                    )}
                </div>
            )}
        </PageShell>
    )
}

function TeamRow({ team, onUpdate, groupSuggestions }: { team: Team, onUpdate: () => void, groupSuggestions: { configured: boolean, groups: string[] } }) {
    const [isEditing, setIsEditing] = useState(false)
    const [name, setName] = useState(team.name)
    const [isLoading, setIsLoading] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)

    useEffect(() => {
        setName(team.name)
    }, [team.name])

    async function handleSave() {
        if (!name.trim()) return

        setIsLoading(true)
        try {
            await updateTeam(team.id, name)
            setIsEditing(false)
            onUpdate()
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    // A team the viewer has no access to is listed so they know it exists and
    // who to ask — but it carries no settings, and the server sent none.
    if (team.access === 'none') {
        return (
            <li className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-3">
                <TeamMark team={team} size={32} className="opacity-70" />
                <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{team.name}</h3>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3 shrink-0" />
                        No access — ask a member of this team to add your group
                    </p>
                </div>
            </li>
        )
    }

    const canAdmin = team.access === 'admin'
    const groupCount = (team.memberGroups?.length ?? 0) + (team.adminGroups?.length ?? 0)
    const settingsId = `team-settings-${team.id}`

    return (
        <li className="@container overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                {canAdmin
                    ? <TeamAvatar team={team} onUpdate={onUpdate} />
                    : <TeamMark team={team} size={48} />}
                <div className="min-w-0 flex-1 basis-48">
                    {isEditing ? (
                        <div className="flex w-full items-center gap-2">
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="h-9 min-w-[100px] flex-1"
                                aria-label="Team name"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSave()
                                    if (e.key === 'Escape') {
                                        setIsEditing(false)
                                        setName(team.name)
                                    }
                                }}
                            />
                            <Button size="sm" onClick={handleSave} disabled={isLoading}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setIsEditing(false); setName(team.name) }}>Cancel</Button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <h3 className="truncate text-lg font-semibold tracking-tight">{team.name}</h3>
                            {canAdmin && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground" onClick={() => setIsEditing(true)} aria-label={`Rename ${team.name}`}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className={cn(
                            'rounded-md px-1.5 py-0.5 font-semibold',
                            canAdmin
                                ? 'bg-[hsl(var(--tone-review-soft))] text-[hsl(var(--tone-review-ink))]'
                                : 'bg-[hsl(var(--tone-improve-soft))] text-[hsl(var(--tone-improve-ink))]',
                        )}>
                            {canAdmin ? 'Team admin' : 'Member'}
                        </span>
                        {canAdmin && (
                            <>
                                <span className="flex items-center gap-1">
                                    <Shield className="h-3 w-3" aria-hidden />
                                    {groupCount > 0 ? `${groupCount} group${groupCount === 1 ? '' : 's'}` : 'Admins only'}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Link2 className="h-3 w-3" aria-hidden />
                                    {team.jiraConfigured ? 'Jira connected' : 'No Jira'}
                                </span>
                            </>
                        )}
                        <span>Created {new Date(team.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {/* Settings are a team-admin act; a member joins the boards
                        but does not rewire who can reach them. The server
                        enforces the same line — this only stops the page
                        offering what it would refuse. */}
                    {canAdmin && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setSettingsOpen((o) => !o)}
                            aria-expanded={settingsOpen}
                            aria-controls={settingsId}
                        >
                            <Settings2 className="h-4 w-4" /> Settings
                            <ChevronDown className={cn('h-4 w-4 transition-transform', settingsOpen && 'rotate-180')} />
                        </Button>
                    )}
                    <CreateRetroDialog preselectedTeamId={team.id} />
                </div>
            </div>
            {canAdmin && settingsOpen && (
                <div id={settingsId} className="grid gap-6 border-t bg-muted/40 p-4 @2xl:grid-cols-2">
                    <AccessGroupsSettings team={team} groupSuggestions={groupSuggestions} onUpdate={onUpdate} />
                    <JiraSettings team={team} />
                </div>
            )}
        </li>
    )
}

function AccessGroupsSettings({
    team,
    groupSuggestions,
    onUpdate,
}: {
    team: Team
    groupSuggestions: { configured: boolean, groups: string[] }
    onUpdate: () => void
}) {
    const [memberGroups, setMemberGroups] = useState<string[]>(team.memberGroups ?? [])
    const [adminGroups, setAdminGroups] = useState<string[]>(team.adminGroups ?? [])
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    useEffect(() => {
        setMemberGroups(team.memberGroups ?? [])
        setAdminGroups(team.adminGroups ?? [])
    }, [team.memberGroups, team.adminGroups])

    const count = (team.memberGroups?.length ?? 0) + (team.adminGroups?.length ?? 0)

    async function handleSave() {
        setSaving(true)
        setMsg(null)
        try {
            await updateTeamGroups(team.id, memberGroups, adminGroups)
            setMsg({ type: 'success', text: 'Access groups saved' })
            onUpdate()
            setTimeout(() => setMsg(null), 3000)
        } catch (e) {
            setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="flex flex-col gap-3">
            <h4 className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Access groups</span>
                <span className={cn('text-xs font-medium', count > 0 ? 'text-[hsl(var(--tone-positive-ink))]' : 'text-muted-foreground')}>
                    {count > 0 ? `${count} configured` : 'Admins only'}
                </span>
            </h4>
                <div className="flex flex-col gap-3">
                    <GroupsField
                        label="Member groups (view & participate)"
                        value={memberGroups}
                        onChange={setMemberGroups}
                        suggestions={groupSuggestions.groups}
                        datalistId={`member-groups-${team.id}`}
                        placeholder={groupSuggestions.configured ? 'Search groups…' : 'e.g. /Eng/Platform'}
                    />
                    <GroupsField
                        label="Admin groups (manage boards)"
                        value={adminGroups}
                        onChange={setAdminGroups}
                        suggestions={groupSuggestions.groups}
                        datalistId={`admin-groups-${team.id}`}
                        placeholder={groupSuggestions.configured ? 'Search groups…' : 'e.g. /Eng/Platform/Admins'}
                    />
                    {!groupSuggestions.configured && (
                        <p className="text-xs text-muted-foreground">
                            Enter group paths/names exactly as they appear in your identity provider.
                        </p>
                    )}
                    {msg && (
                        <p role="status" className={cn('text-xs font-medium', msg.type === 'success' ? 'text-[hsl(var(--tone-positive-ink))]' : 'text-destructive')}>{msg.text}</p>
                    )}
                    <Button size="sm" className="self-start" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save access groups'}
                    </Button>
                </div>
        </section>
    )
}

function JiraSettings({ team }: { team: Team }) {
    const [baseUrl, setBaseUrl] = useState(team.jiraBaseUrl ?? '')
    const [projectKey, setProjectKey] = useState(team.jiraProjectKey ?? '')
    const [email, setEmail] = useState(team.jiraEmail ?? '')
    const [apiToken, setApiToken] = useState('')
    const [configured, setConfigured] = useState(Boolean(team.jiraConfigured))
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

    async function handleSave() {
        setSaving(true)
        setMsg(null)
        try {
            const result = await updateTeamJira(team.id, {
                jiraBaseUrl: baseUrl,
                jiraProjectKey: projectKey,
                jiraEmail: email,
                jiraApiToken: apiToken,
            })
            setConfigured(Boolean(result.jiraConfigured))
            setApiToken('')
            setMsg({ type: 'success', text: 'Jira settings saved' })
            setTimeout(() => setMsg(null), 3000)
        } catch (e) {
            setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' })
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="@container flex flex-col gap-3">
            <h4 className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Jira integration</span>
                <span className={cn('text-xs font-medium', configured ? 'text-[hsl(var(--tone-positive-ink))]' : 'text-muted-foreground')}>
                    {configured ? 'Connected' : 'Not configured'}
                </span>
            </h4>
                <div className="grid gap-2 @md:grid-cols-2">
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`jira-url-${team.id}`}>Base URL</Label>
                        <Input id={`jira-url-${team.id}`} className="h-8 bg-card" placeholder="https://jira.example.com" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`jira-key-${team.id}`}>Project key</Label>
                        <Input id={`jira-key-${team.id}`} className="h-8 bg-card" placeholder="PROJ" value={projectKey} onChange={e => setProjectKey(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`jira-email-${team.id}`}>Account email</Label>
                        <Input id={`jira-email-${team.id}`} className="h-8 bg-card" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`jira-token-${team.id}`}>API token</Label>
                        <Input id={`jira-token-${team.id}`} className="h-8 bg-card" type="password" placeholder={configured ? 'Leave blank to keep current' : 'Atlassian API token'} value={apiToken} onChange={e => setApiToken(e.target.value)} />
                    </div>
                    {msg && (
                        <p role="status" className={cn('text-xs font-medium @md:col-span-2', msg.type === 'success' ? 'text-[hsl(var(--tone-positive-ink))]' : 'text-destructive')}>{msg.text}</p>
                    )}
                    <Button size="sm" className="justify-self-start @md:col-span-2" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save Jira settings'}
                    </Button>
                </div>
        </section>
    )
}

/** Downscale an image file to a small square-ish PNG data URI for storage. */
async function fileToResizedDataUrl(file: File, max = 128): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read file'))
        reader.readAsDataURL(file)
    })
    // SVGs are already tiny and vector — keep as-is.
    if (file.type === 'image/svg+xml') return dataUrl

    return new Promise<string>((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const scale = Math.min(1, max / Math.max(img.width, img.height))
            const w = Math.round(img.width * scale)
            const h = Math.round(img.height * scale)
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            if (!ctx) return reject(new Error('Canvas not supported'))
            ctx.drawImage(img, 0, 0, w, h)
            resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error('Invalid image'))
        img.src = dataUrl
    })
}

/** Team logo with a sensible default icon when no image is set, plus upload/remove. */
function TeamAvatar({ team, onUpdate }: { team: Team, onUpdate: () => void }) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = '' // allow re-selecting the same file
        if (!file) return
        setErr(null)
        setBusy(true)
        try {
            const dataUrl = await fileToResizedDataUrl(file)
            await updateTeamImage(team.id, dataUrl)
            onUpdate()
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : 'Upload failed')
        } finally {
            setBusy(false)
        }
    }

    async function handleRemove() {
        setBusy(true)
        setErr(null)
        try {
            await updateTeamImage(team.id, null)
            onUpdate()
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : 'Failed to remove image')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col items-center gap-1">
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                title="Upload team image"
                aria-label={`Upload a logo for ${team.name}`}
                className="group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[30%] border bg-primary/10"
            >
                {team.imageData ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.imageData} alt={`${team.name} logo`} className="h-full w-full object-cover" />
                ) : (
                    // Sensible default when no image is set.
                    <Users className="h-6 w-6 text-primary" />
                )}
                <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex group-focus-visible:flex">
                    <ImagePlus className="h-4 w-4" />
                </span>
            </button>
            {team.imageData && (
                <button
                    type="button"
                    onClick={handleRemove}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-0.5"
                >
                    <Trash2 className="h-3 w-3" /> Remove
                </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            {err && <span className="max-w-[80px] text-center text-xs text-destructive">{err}</span>}
        </div>
    )
}
