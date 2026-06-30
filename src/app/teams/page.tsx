'use client'

import { useState, useEffect } from 'react'
import { createTeam, getTeams, updateTeam, updateTeamJira } from '@/app/actions'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Plus, CheckCircle, AlertCircle, Pencil, Link2 } from 'lucide-react'
import { CreateRetroDialog } from "@/components/CreateRetroDialog"
import { useSearchParams } from 'next/navigation'

type Team = {
    id: string
    name: string
    createdAt: Date
    jiraBaseUrl?: string | null
    jiraProjectKey?: string | null
    jiraEmail?: string | null
    jiraConfigured?: boolean
}

export default function TeamsPage() {
    const [teams, setTeams] = useState<Team[]>([])
    const [newTeamName, setNewTeamName] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
    // ...
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
            await createTeam(newTeamName)
            setNewTeamName('')
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
                    <form onSubmit={handleCreateTeam} className="flex gap-4">
                        <Input 
                            placeholder="Enter team name (e.g. Engineering, Design)" 
                            value={newTeamName}
                            onChange={(e) => setNewTeamName(e.target.value)}
                            className="max-w-md"
                        />
                        <Button type="submit" disabled={isLoading || !newTeamName.trim()}>
                            {isLoading ? "Creating..." : "Create Team"}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teams.map((team) => (
                    <TeamCard 
                        key={team.id} 
                        team={team} 
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

function TeamCard({ team, onUpdate }: { team: Team, onUpdate: () => void }) {
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
                    <div className="p-3 bg-primary/10 rounded-full">
                        <Users className="w-6 h-6 text-primary" />
                    </div>
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
                <JiraSettings team={team} />
                <div className="w-full">
                    <CreateRetroDialog preselectedTeamId={team.id} />
                </div>
            </CardContent>
        </Card>
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
