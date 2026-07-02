'use client'

import { useState, useEffect, useRef } from 'react'
import { createTeam, getTeams, updateTeam, updateTeamJira, updateTeamGroups, updateTeamImage } from '@/app/actions'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Plus, CheckCircle, AlertCircle, Pencil, Link2, Shield, ImagePlus, Trash2 } from 'lucide-react'
import { CreateRetroDialog } from "@/components/CreateRetroDialog"
import { useSearchParams } from 'next/navigation'
import { GroupsField, useKeycloakGroups } from "@/components/GroupsField"

type Team = {
    id: string
    name: string
    createdAt: Date
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
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    const groupSuggestions = useKeycloakGroups()
    const searchParams = useSearchParams()
    const teamFilter = searchParams.get('teamId')

    useEffect(() => {
        loadTeams()
    }, [teamFilter])

    async function loadTeams() {
        try {
            const loadedTeams = await getTeams()
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

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
                    <p className="text-muted-foreground mt-2">Manage your teams here. Create teams before starting retrospectives.</p>
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded-md flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                    {message.text}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Plus className="w-5 h-5" />
                        Create New Team
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleCreateTeam} className="flex flex-col gap-4">
                        <div className="flex gap-4">
                            <Input
                                placeholder="Enter team name (e.g. Engineering, Design)"
                                value={newTeamName}
                                onChange={(e) => setNewTeamName(e.target.value)}
                                className="max-w-md"
                            />
                            <Button type="submit" disabled={isLoading || !newTeamName.trim()}>
                                {isLoading ? "Creating..." : "Create Team"}
                            </Button>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
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
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Groups come from your identity provider (e.g. AD/Keycloak). Leave empty to restrict the
                            team to global admins. You can change these later in the team&apos;s settings.
                        </p>
                    </form>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teams.map((team) => (
                    <TeamCard
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
                ))}
                {teams.length === 0 && (
                    <div className="col-span-full text-center p-8 border-2 border-dashed rounded-lg text-muted-foreground">
                        No teams found. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    )
}

function TeamCard({ team, onUpdate, groupSuggestions }: { team: Team, onUpdate: () => void, groupSuggestions: { configured: boolean, groups: string[] } }) {
    const [isEditing, setIsEditing] = useState(false)
    const [name, setName] = useState(team.name)
    const [isLoading, setIsLoading] = useState(false)

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

    return (
        <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-6 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                    <TeamAvatar team={team} onUpdate={onUpdate} />
                    <div className="flex-1 min-w-0">
                        {isEditing ? (
                            <div className="flex gap-2 items-center w-full">
                                <Input 
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="h-8 flex-1 min-w-[100px]"
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
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-semibold text-lg truncate">{team.name}</h3>
                                    <p className="text-xs text-muted-foreground">
                                        Created {new Date(team.createdAt).toLocaleDateString()}
                                    </p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setIsEditing(true)}>
                                    <Pencil className="w-3 h-3" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                <AccessGroupsSettings team={team} groupSuggestions={groupSuggestions} onUpdate={onUpdate} />
                <JiraSettings team={team} />
                <div className="w-full">
                    <CreateRetroDialog preselectedTeamId={team.id} />
                </div>
            </CardContent>
        </Card>
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
    const [open, setOpen] = useState(false)
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
        <div className="w-full border rounded-lg">
            <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
                onClick={() => setOpen(o => !o)}
            >
                <span className="flex items-center gap-2">
                    <Shield className="w-4 h-4" /> Access groups
                </span>
                <span className={`text-xs ${count > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {count > 0 ? `${count} configured` : 'Admins only'}
                </span>
            </button>
            {open && (
                <div className="px-3 pb-3 flex flex-col gap-3">
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
                        <p className={`text-xs ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
                    )}
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save access groups'}
                    </Button>
                </div>
            )}
        </div>
    )
}

function JiraSettings({ team }: { team: Team }) {
    const [open, setOpen] = useState(false)
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
        <div className="w-full border rounded-lg">
            <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
                onClick={() => setOpen(o => !o)}
            >
                <span className="flex items-center gap-2">
                    <Link2 className="w-4 h-4" /> Jira integration
                </span>
                <span className={`text-xs ${configured ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {configured ? 'Connected' : 'Not configured'}
                </span>
            </button>
            {open && (
                <div className="px-3 pb-3 flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Base URL</Label>
                        <Input className="h-8" placeholder="https://yourco.atlassian.net" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Project key</Label>
                        <Input className="h-8" placeholder="PROJ" value={projectKey} onChange={e => setProjectKey(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Account email</Label>
                        <Input className="h-8" placeholder="you@yourco.com" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">API token</Label>
                        <Input className="h-8" type="password" placeholder={configured ? 'Leave blank to keep current' : 'Atlassian API token'} value={apiToken} onChange={e => setApiToken(e.target.value)} />
                    </div>
                    {msg && (
                        <p className={`text-xs ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
                    )}
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving…' : 'Save Jira settings'}
                    </Button>
                </div>
            )}
        </div>
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
                className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-full border bg-primary/10 flex items-center justify-center"
            >
                {team.imageData ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={team.imageData} alt={`${team.name} logo`} className="h-full w-full object-cover" />
                ) : (
                    // Sensible default when no image is set.
                    <Users className="h-6 w-6 text-primary" />
                )}
                <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-white group-hover:flex">
                    <ImagePlus className="h-4 w-4" />
                </span>
            </button>
            {team.imageData && (
                <button
                    type="button"
                    onClick={handleRemove}
                    disabled={busy}
                    className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-0.5"
                >
                    <Trash2 className="h-3 w-3" /> Remove
                </button>
            )}
            <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            {err && <span className="text-[10px] text-red-600 max-w-[80px] text-center">{err}</span>}
        </div>
    )
}
