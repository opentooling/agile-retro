import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
// next-auth/jwt ships `getToken` at runtime, but its type declarations only
// re-export @auth/core/jwt (which omits it), so we access it via a cast.
import * as NextAuthJwt from "next-auth/jwt";
const getToken = (NextAuthJwt as any).getToken as (opts: any) => Promise<any>;
import * as db from "./src/lib/db";
import { redactRetroFull, applyBlindInput } from "./src/lib/sanitize";
import { pushActionDoneState } from "./src/lib/jira-sync";
import { purgeExpiredRetros } from "./src/lib/purge";
import { placeBefore } from "./src/lib/board-order";
import { snoozePhase } from "./src/lib/phase-timer";
import { acceptText } from "./src/lib/text-limits";
import {
    authUserFromToken,
    canViewBoard,
    canContributeToBoard,
    canManageBoard,
    canEditItem,
    canRearrangeItem,
    canChangeActionItems,
    type AuthUser,
    type RetroRef,
} from "./src/lib/authz";

/**
 * Resolve the authenticated user from the Socket.IO handshake cookie. The
 * browser sends the NextAuth session cookie automatically on the same-origin
 * websocket handshake, so we can decode it with the shared AUTH_SECRET. We try
 * both the secure (`__Secure-`) and non-secure cookie names so it works behind
 * https and on plain http in dev.
 */
async function getSocketUser(cookie: string | undefined): Promise<AuthUser | null> {
    if (!cookie) return null;
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        console.error("AUTH_SECRET is not set; cannot authenticate socket connections");
        return null;
    }
    const req = { headers: { cookie } } as any;
    for (const secureCookie of [true, false]) {
        try {
            const token = await getToken({ req, secret, secureCookie });
            const user = authUserFromToken(token);
            if (user) return user;
        } catch {
            // Try the other cookie flavor.
        }
    }
    return null;
}

/**
 * Broadcast the board to everyone in the room.
 *
 * Normally that's a single payload for the whole room. Under "blind input"
 * during the INPUT phase each participant must see only their own items, so the
 * payload differs per viewer and we emit once per socket — the hidden items
 * never leave the server. The cheap room-wide path is kept for every other
 * case, which is the overwhelming majority of broadcasts.
 */
async function broadcastRetro(io: Server, retroId: string, retro: any): Promise<void> {
    const payload = redactRetroFull(retro);
    if (!payload || !payload.blindInput || payload.status !== "INPUT") {
        io.to(retroId).emit("retro-updated", payload);
        return;
    }
    const sockets = await io.in(retroId).fetchSockets();
    for (const s of sockets) {
        const viewer = (s.data as { user?: AuthUser }).user;
        s.emit("retro-updated", applyBlindInput(payload, viewer?.id));
    }
}

/** Lightweight board reference (team + creator) used for authorization checks. */
async function loadRetroRef(retroId: string): Promise<RetroRef | null> {
    const retro = await db.getRetro(retroId);
    if (!retro) return null;
    const team = retro.teamId ? await db.getTeam(retro.teamId) : null;
    return { teamId: retro.teamId, creator: retro.creator, team, status: retro.status };
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

/**
 * Retention sweep. Boards given a TTL at creation are deleted once it elapses;
 * without this nothing would ever act on `expiresAt`. Runs on startup and then
 * hourly — the exact moment of deletion doesn't matter, only that it happens.
 */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_START_DELAY_MS = 30 * 1000;
async function sweepExpiredBoards(): Promise<void> {
    try {
        const deleted = await purgeExpiredRetros();
        if (deleted.length > 0) {
            console.log(`Retention sweep: deleted ${deleted.length} expired board(s)`);
        }
    } catch (err) {
        console.error("Retention sweep failed:", err);
    }
}

app.prepare().then(() => {
    const httpServer = createServer(handler);

    // Delay the first sweep: the database container often isn't accepting
    // connections yet when this process starts, and an immediate sweep just
    // logs a failure nobody needs to see.
    setTimeout(() => void sweepExpiredBoards(), PURGE_START_DELAY_MS).unref();
    setInterval(() => void sweepExpiredBoards(), PURGE_INTERVAL_MS).unref();

    const io = new Server(httpServer);

    // Authenticate every socket connection from the handshake cookie. Sockets
    // without a valid session are rejected — the app already requires login via
    // Next.js middleware, so an unauthenticated socket should not exist.
    io.use(async (socket, nextFn) => {
        const user = await getSocketUser(socket.handshake.headers.cookie);
        if (!user) {
            return nextFn(new Error("unauthorized"));
        }
        socket.data.user = user;
        nextFn();
    });

    // In-memory participant tracking
    // retroId -> { socketId: { userId, username, isReady } }
    const participants: Record<string, Record<string, { userId: string, username: string, isReady: boolean }>> = {};

    io.on("connection", (socket) => {
        const user = socket.data.user as AuthUser;
        console.log("Client connected", socket.id, user.id);

        // The phase clock counts against the server's clock, not the device's.
        // Phase starts are stamped here, so a browser whose clock disagrees —
        // or a server whose own has drifted — otherwise reads the timer wrong,
        // by exactly the difference. The client times the round trip and
        // corrects for it (lib/phase-timer clockOffset).
        socket.on("time-check", (payload: { sentAt?: number } | undefined) => {
            socket.emit("time-reply", { sentAt: payload?.sentAt, serverTime: Date.now() });
        });

        socket.on("join-retro", async ({ retroId }) => {
            try {
                const ref = await loadRetroRef(retroId);
                if (!ref) return;

                // Enforce board access: team-aligned boards are restricted to
                // their members / team-admins / admins; open boards are visible
                // to any authenticated user.
                if (!canViewBoard(user, ref)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }

                socket.join(retroId);
                console.log(`Socket ${socket.id} joined retro ${retroId} as ${user.name ?? user.id}`);

                // Catch the newcomer up. Their page's board was read when the
                // page rendered; anything that changed between then and joining
                // this room was broadcast to a room they were not yet in, and
                // stayed invisible to them until the next change. Same
                // redaction as a broadcast, including blind input.
                const current = redactRetroFull(await db.getRetroFull(retroId));
                if (current) {
                    socket.emit(
                        "retro-updated",
                        current.blindInput && current.status === "INPUT" ? applyBlindInput(current, user.id) : current,
                    );
                }

                const status = await db.getRetroStatus(retroId);
                if (status?.status === 'CLOSED') {
                    return;
                }

                if (!participants[retroId]) {
                    participants[retroId] = {};
                }
                // Identity comes from the authenticated session, never the client.
                participants[retroId][socket.id] = { userId: user.id, username: user.name ?? user.id, isReady: false };

                io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
            } catch (error) {
                console.error("Error joining retro:", error);
            }
        });

        // Authorization guards. Each returns the board reference when the
        // authenticated user is allowed to perform the action, or null (having
        // emitted "access-denied") otherwise. Callers that only need the board
        // to exist can ignore the ref.
        const requireView = async (retroId: string): Promise<RetroRef | null> => {
            const ref = await loadRetroRef(retroId);
            if (!ref) return null;
            if (!canViewBoard(user, ref)) {
                socket.emit("access-denied", { retroId });
                return null;
            }
            return ref;
        };
        /**
         * For anything that writes. Distinct from requireView: a closed board
         * stays readable but is frozen, and previously every mutating handler
         * used requireView (or no guard at all), so "read-only" was a label on
         * a screen rather than a rule.
         */
        const requireContribute = async (retroId: string): Promise<RetroRef | null> => {
            const ref = await loadRetroRef(retroId);
            if (!ref) return null;
            if (!canContributeToBoard(user, ref)) {
                socket.emit("access-denied", { retroId });
                return null;
            }
            return ref;
        };
        const requireManage = async (retroId: string): Promise<RetroRef | null> => {
            const ref = await loadRetroRef(retroId);
            if (!ref) return null;
            if (!canManageBoard(user, ref)) {
                socket.emit("access-denied", { retroId });
                return null;
            }
            return ref;
        };

        socket.on("user-ready", async ({ retroId, isReady }) => {
            if (!(await requireContribute(retroId))) return;
            if (participants[retroId] && participants[retroId][socket.id]) {
                participants[retroId][socket.id].isReady = isReady;
                io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
            }
        });

        socket.on("add-item", async ({ retroId, columnId, content }) => {
            try {
                const ref = await requireContribute(retroId);
                if (!ref) return;
                // Cards are written during Input — the only phase that offers it.
                if (ref.status !== "INPUT") return;
                const text = acceptText(content);
                if (!text) return;
                // The column must be on the board named. The access check above
                // is for that board; without this, contributing to any open
                // board let you plant cards on another team's private board.
                const retro = await db.getRetroFull(retroId);
                if (!retro?.columns.some((c) => c.id === columnId)) return;

                // Get max order in this column
                const nextOrder = (await db.itemMaxOrder(columnId) ?? -1) + 1;

                // Authorship is taken from the authenticated session, not the client.
                await db.createItem({
                    content: text,
                    columnId,
                    userId: user.id,
                    username: user.name ?? user.id,
                    order: nextOrder
                });

                // Fetch updated retro
                const updatedRetro = await db.getRetroFull(retroId);

                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error adding item:", error);
            }
        });

        socket.on("edit-item", async ({ retroId, itemId, content }) => {
            try {
                const ref = await loadRetroRef(retroId);
                if (!ref) return;
                const item = await db.getItem(itemId);
                if (!item) return;
                // Only the author, facilitator, team-admin or admin may edit.
                if (!canEditItem(user, ref, item)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }
                const trimmed = acceptText(content);
                if (!trimmed) return;
                await db.updateItemContent(itemId, trimmed);

                const updatedRetro = await db.getRetroFull(retroId);
                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error editing item:", error);
            }
        });

        socket.on("vote", async ({ retroId, itemId, delta }) => {
            try {
                if (!(await requireContribute(retroId))) return;

                // Votes belong to the authenticated user, never a client id.
                const existingVote = await db.findVote(itemId, user.id);

                if (existingVote) {
                    const newCount = existingVote.count + delta;
                    if (newCount <= 0) {
                        await db.deleteVote(existingVote.id);
                    } else {
                        await db.updateVoteCount(existingVote.id, newCount);
                    }
                } else if (delta > 0) {
                    await db.createVote({ itemId, userId: user.id, count: delta });
                }

                // Fetch updated retro and emit
                const updatedRetro = await db.getRetroFull(retroId);

                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error voting:", error);
            }
        });

        socket.on("update-status", async ({ retroId, status }) => {
            try {
                // Phase changes are a management action.
                if (!(await requireManage(retroId))) return;
                // Only phases the app knows. Anything else left the board in a
                // state no screen could render.
                if (!["INPUT", "VOTING", "REVIEW", "ACTIONS", "CLOSED"].includes(status)) return;

                const updatedRetro = await db.updateRetroStatus(retroId, status, new Date());

                // Reset readiness on phase change
                if (participants[retroId]) {
                    Object.keys(participants[retroId]).forEach(socketId => {
                        participants[retroId][socketId].isReady = false;
                    });
                    io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
                }

                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error updating status:", error);
            }
        });

        socket.on("update-item-summary", async ({ retroId, itemId, summary }) => {
            try {
                const ref = await loadRetroRef(retroId);
                if (!ref) return;
                const item = await db.getItem(itemId);
                if (!item) return;
                if (!canEditItem(user, ref, item)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }
                await db.updateItemSummary(itemId, summary);

                const updatedRetro = await db.getRetroFull(retroId);
                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error updating summary:", error);
            }
        });

        socket.on("add-action-item", async ({ retroId, content, assignee, dueDate }) => {
            try {
                if (!(await requireContribute(retroId))) return;
                const text = acceptText(content);
                if (!text) return;
                const due = dueDate ? new Date(dueDate) : null;
                await db.createActionItem({
                    content: text,
                    retrospectiveId: retroId,
                    assignee: assignee && String(assignee).trim() ? String(assignee).trim() : null,
                    dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
                });

                const updatedRetro = await db.getRetroFull(retroId);
                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error adding action item:", error);
            }
        });

        socket.on("toggle-action-item", async ({ retroId, actionId }) => {
            try {
                if (!(await requireView(retroId))) return;
                const action = await db.getActionItem(actionId);
                // The access check above is for the board the client *named*.
                // Without this, access to any board — every open board counts —
                // was enough to toggle an action from any other team's board.
                if (action && action.retrospectiveId === retroId) {
                    const newCompleted = !action.completed;
                    await db.updateActionCompleted(actionId, newCompleted);

                    const updatedRetro = await db.getRetroFull(retroId);
                    await broadcastRetro(io, retroId, updatedRetro);

                    // Mirror the new state to the linked Jira issue (best-effort).
                    await pushActionDoneState(actionId, newCompleted);
                }
            } catch (error) {
                console.error("Error toggling action item:", error);
            }
        });

        socket.on("toggle-reaction", async ({ retroId, itemId, emoji }) => {
            try {
                if (!(await requireContribute(retroId))) return;
                // Reactions belong to the authenticated user.
                const existingReaction = await db.findReaction(itemId, user.id, emoji);

                if (existingReaction) {
                    await db.deleteReaction(existingReaction.id);
                } else {
                    await db.createReaction({ itemId, userId: user.id, emoji });
                }

                const updatedRetro = await db.getRetroFull(retroId);
                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error toggling reaction:", error);
            }
        });

        /**
         * Load a board and one of its cards, confirming the card is really on
         * that board. Every handler that takes an item id checks this: the
         * access check covers the board the client *named*, so without it,
         * access to any board — every open board counts — reached any card.
         */
        const loadItemOnBoard = async (retroId: string, itemId: string) => {
            const retro = await db.getRetroFull(retroId);
            if (!retro) return null;
            const column = retro.columns.find((c) => c.items.some((i) => i.id === itemId));
            if (!column) return null;
            const item = column.items.find((i) => i.id === itemId)!;
            const ref: RetroRef = { teamId: retro.teamId, creator: retro.creator, team: retro.team, status: retro.status };
            return { retro, column, item, ref };
        };

        /**
         * Move a card within its column or into another one.
         *
         * The position is "before this card" rather than an index: with blind
         * input a participant sees only their own cards, so an index they
         * computed refers to a column they cannot see. Previously this handler
         * trusted the item id, the target column and the index as given, let
         * any contributor move anyone's card, and ran in every phase.
         */
        socket.on("move-item", async ({ retroId, itemId, targetColumnId, beforeItemId }) => {
            try {
                const found = await loadItemOnBoard(retroId, itemId);
                if (!found) return;
                const { retro, item, ref } = found;
                const target = retro.columns.find((c) => c.id === targetColumnId);
                if (!target) return; // a column on some other board
                if (!canRearrangeItem(user, ref, item)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }

                if (item.columnId !== target.id) {
                    await db.updateItemColumn(itemId, target.id);
                }
                const order = placeBefore(
                    target.items.map((i) => i.id),
                    itemId,
                    typeof beforeItemId === "string" ? beforeItemId : null,
                );
                await db.reorderItems(order);

                await broadcastRetro(io, retroId, await db.getRetroFull(retroId));
            } catch (error) {
                console.error("Error moving item:", error);
            }
        });

        /** Delete a card while cards are still being written. */
        socket.on("delete-item", async ({ retroId, itemId }) => {
            try {
                const found = await loadItemOnBoard(retroId, itemId);
                if (!found) return;
                if (!canRearrangeItem(user, found.ref, found.item)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }
                await db.deleteItem(itemId);
                await broadcastRetro(io, retroId, await db.getRetroFull(retroId));
            } catch (error) {
                console.error("Error deleting item:", error);
            }
        });

        /** Load an action and confirm it belongs to the board named. */
        const loadActionOnBoard = async (retroId: string, actionId: string) => {
            const ref = await loadRetroRef(retroId);
            if (!ref) return null;
            const action = await db.getActionItem(actionId);
            if (!action || action.retrospectiveId !== retroId) return null;
            return { ref, action };
        };

        /** Rewrite an action's text, assignee or due date during the Actions phase. */
        socket.on("update-action-item", async ({ retroId, actionId, content, assignee, dueDate }) => {
            try {
                const found = await loadActionOnBoard(retroId, actionId);
                if (!found) return;
                if (!canChangeActionItems(user, found.ref)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }
                const text = acceptText(content);
                if (!text) return;
                const due = dueDate ? new Date(dueDate) : null;
                await db.updateActionItem(actionId, {
                    content: text,
                    assignee: assignee && String(assignee).trim() ? String(assignee).trim() : null,
                    dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
                });
                await broadcastRetro(io, retroId, await db.getRetroFull(retroId));
            } catch (error) {
                console.error("Error updating action item:", error);
            }
        });

        /**
         * Delete an action during the Actions phase. A linked Jira issue is left
         * alone: the app created it, but it may have gathered history of its
         * own, and deleting work in someone else's tracker is not this button's
         * job.
         */
        socket.on("delete-action-item", async ({ retroId, actionId }) => {
            try {
                const found = await loadActionOnBoard(retroId, actionId);
                if (!found) return;
                if (!canChangeActionItems(user, found.ref)) {
                    socket.emit("access-denied", { retroId });
                    return;
                }
                await db.deleteActionItem(actionId);
                await broadcastRetro(io, retroId, await db.getRetroFull(retroId));
            } catch (error) {
                console.error("Error deleting action item:", error);
            }
        });

        socket.on("extend-timer", async ({ retroId }) => {
            try {
                // Extending the timer is a management action.
                if (!(await requireManage(retroId))) return;

                const retro = await db.getRetro(retroId);
                if (!retro) return;

                const field = ({ INPUT: 'inputDuration', VOTING: 'votingDuration', REVIEW: 'reviewDuration' } as const)[
                    retro.status as 'INPUT' | 'VOTING' | 'REVIEW'
                ];
                if (!field) return; // No timer for other phases

                // Five more minutes from the later of the deadline and now — in
                // overtime, from now (see lib/phase-timer).
                const snoozed = snoozePhase(
                    retro.phaseStartTime ? new Date(retro.phaseStartTime) : null,
                    retro[field] ?? null,
                    new Date(),
                );
                const updatedRetro = await db.updateRetroDurations(retroId, {
                    [field]: snoozed.durationMinutes,
                    phaseStartTime: snoozed.phaseStart,
                });
                await broadcastRetro(io, retroId, updatedRetro);
            } catch (error) {
                console.error("Error extending timer:", error);
            }
        });

        socket.on("disconnect", async () => {
            console.log("Client disconnected", socket.id);
            // Remove user from participants
            for (const retroId in participants) {
                if (participants[retroId][socket.id]) {
                    delete participants[retroId][socket.id];

                    try {
                        const retro = await db.getRetroStatus(retroId);

                        if (retro?.status !== 'CLOSED') {
                            io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
                        }
                    } catch (error) {
                        console.error("Error handling disconnect:", error);
                    }
                }
            }
        });
    });
    httpServer
        .once("error", (err) => {
            console.error(err);
            process.exit(1);
        })
        .listen(port, () => {
            console.log(`> Ready on http://${hostname}:${port}`);
        });
});
