import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
// next-auth/jwt ships `getToken` at runtime, but its type declarations only
// re-export @auth/core/jwt (which omits it), so we access it via a cast.
import * as NextAuthJwt from "next-auth/jwt";
const getToken = (NextAuthJwt as any).getToken as (opts: any) => Promise<any>;
import * as db from "./src/lib/db";
import { redactRetroFull } from "./src/lib/sanitize";
import { pushActionDoneState } from "./src/lib/jira-sync";
import {
    authUserFromToken,
    canViewBoard,
    canManageBoard,
    canEditItem,
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

/** Lightweight board reference (team + creator) used for authorization checks. */
async function loadRetroRef(retroId: string): Promise<RetroRef | null> {
    const retro = await db.getRetro(retroId);
    if (!retro) return null;
    const team = retro.teamId ? await db.getTeam(retro.teamId) : null;
    return { teamId: retro.teamId, creator: retro.creator, team };
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
    const httpServer = createServer(handler);

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
            if (!(await requireView(retroId))) return;
            if (participants[retroId] && participants[retroId][socket.id]) {
                participants[retroId][socket.id].isReady = isReady;
                io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
            }
        });

        socket.on("add-item", async ({ retroId, columnId, content }) => {
            try {
                if (!(await requireView(retroId))) return;

                // Get max order in this column
                const nextOrder = (await db.itemMaxOrder(columnId) ?? -1) + 1;

                // Authorship is taken from the authenticated session, not the client.
                await db.createItem({
                    content,
                    columnId,
                    userId: user.id,
                    username: user.name ?? user.id,
                    order: nextOrder
                });

                // Fetch updated retro
                const updatedRetro = await db.getRetroFull(retroId);

                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
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
                const trimmed = String(content ?? "").trim();
                if (!trimmed) return;
                await db.updateItemContent(itemId, trimmed);

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error editing item:", error);
            }
        });

        socket.on("vote", async ({ retroId, itemId, delta }) => {
            try {
                if (!(await requireView(retroId))) return;

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

                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error voting:", error);
            }
        });

        socket.on("update-status", async ({ retroId, status }) => {
            try {
                // Phase changes are a management action.
                if (!(await requireManage(retroId))) return;

                const updatedRetro = await db.updateRetroStatus(retroId, status, new Date());

                // Reset readiness on phase change
                if (participants[retroId]) {
                    Object.keys(participants[retroId]).forEach(socketId => {
                        participants[retroId][socketId].isReady = false;
                    });
                    io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
                }

                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
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
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error updating summary:", error);
            }
        });

        socket.on("add-action-item", async ({ retroId, content, assignee, dueDate }) => {
            try {
                if (!(await requireView(retroId))) return;
                await db.createActionItem({
                    content,
                    retrospectiveId: retroId,
                    assignee: assignee && String(assignee).trim() ? String(assignee).trim() : null,
                    dueDate: dueDate ? new Date(dueDate) : null,
                });

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error adding action item:", error);
            }
        });

        socket.on("toggle-action-item", async ({ retroId, actionId }) => {
            try {
                if (!(await requireView(retroId))) return;
                const action = await db.getActionItem(actionId);
                if (action) {
                    const newCompleted = !action.completed;
                    await db.updateActionCompleted(actionId, newCompleted);

                    const updatedRetro = await db.getRetroFull(retroId);
                    io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));

                    // Mirror the new state to the linked Jira issue (best-effort).
                    await pushActionDoneState(actionId, newCompleted);
                }
            } catch (error) {
                console.error("Error toggling action item:", error);
            }
        });

        socket.on("toggle-reaction", async ({ retroId, itemId, emoji }) => {
            try {
                if (!(await requireView(retroId))) return;
                // Reactions belong to the authenticated user.
                const existingReaction = await db.findReaction(itemId, user.id, emoji);

                if (existingReaction) {
                    await db.deleteReaction(existingReaction.id);
                } else {
                    await db.createReaction({ itemId, userId: user.id, emoji });
                }

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error toggling reaction:", error);
            }
        });

        socket.on("move-item", async ({ retroId, itemId, targetColumnId, newIndex }) => {
            try {
                if (!(await requireView(retroId))) return;

                // 1. Get the item to verify it exists and get its current column
                const itemToMove = await db.getItem(itemId);
                if (!itemToMove) return;

                // 2. Update the item's column immediately (if changed)
                if (itemToMove.columnId !== targetColumnId) {
                    await db.updateItemColumn(itemId, targetColumnId);
                }

                // 3. Reorder items in the target column
                // Fetch all items in the target column (including the moved one)
                const itemsInColumn = await db.listItemsInColumn(targetColumnId);

                // Remove the moved item from the array (if it's there - it might be if we just updated columnId)
                const otherItems = itemsInColumn.filter((i) => i.id !== itemId);

                // Insert at new index
                // Clamp index to valid range
                const insertIndex = Math.max(0, Math.min(newIndex, otherItems.length));
                otherItems.splice(insertIndex, 0, { ...itemToMove, columnId: targetColumnId });

                // Update order for all items in the column, atomically.
                await db.reorderItems(otherItems.map((item) => item.id));

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error moving item:", error);
            }
        });

        socket.on("extend-timer", async ({ retroId }) => {
            try {
                // Extending the timer is a management action.
                if (!(await requireManage(retroId))) return;

                const retro = await db.getRetro(retroId);
                if (!retro) return;

                const updateData: { inputDuration?: number; votingDuration?: number; reviewDuration?: number } = {};
                if (retro.status === 'INPUT') {
                    updateData.inputDuration = (retro.inputDuration || 0) + 5;
                } else if (retro.status === 'VOTING') {
                    updateData.votingDuration = (retro.votingDuration || 0) + 5;
                } else if (retro.status === 'REVIEW') {
                    updateData.reviewDuration = (retro.reviewDuration || 0) + 5;
                } else {
                    return; // No timer for other phases
                }

                const updatedRetro = await db.updateRetroDurations(retroId, updateData);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
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
