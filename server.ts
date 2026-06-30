import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import * as db from "./src/lib/db";
import { redactRetroFull } from "./src/lib/sanitize";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
    const httpServer = createServer(handler);

    const io = new Server(httpServer);

    // Note: We'll use a local instance here to avoid issues with singleton across different contexts if any


    // In-memory participant tracking
    // retroId -> { socketId: { userId, username, isReady } }
    const participants: Record<string, Record<string, { userId: string, username: string, isReady: boolean }>> = {};

    io.on("connection", (socket) => {
        console.log("Client connected", socket.id);

        socket.on("join-retro", async ({ retroId, userId, username }) => {
            socket.join(retroId);
            console.log(`Socket ${socket.id} joined retro ${retroId} as ${username}`);

            try {
                const retro = await db.getRetroStatus(retroId);

                if (retro?.status === 'CLOSED') {
                    return;
                }

                if (!participants[retroId]) {
                    participants[retroId] = {};
                }
                participants[retroId][socket.id] = { userId, username, isReady: false };

                io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
            } catch (error) {
                console.error("Error joining retro:", error);
            }
        });

        socket.on("user-ready", ({ retroId, isReady }) => {
            if (participants[retroId] && participants[retroId][socket.id]) {
                participants[retroId][socket.id].isReady = isReady;
                io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
            }
        });

        socket.on("add-item", async ({ retroId, columnId, content, userId, username }) => {
            try {
                // Get max order in this column
                const nextOrder = (await db.itemMaxOrder(columnId) ?? -1) + 1;

                await db.createItem({
                    content,
                    columnId,
                    userId: userId || "anonymous",
                    username: username || "Anonymous",
                    order: nextOrder
                });

                // Fetch updated retro
                const updatedRetro = await db.getRetroFull(retroId);

                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error adding item:", error);
            }
        });

        socket.on("vote", async ({ retroId, itemId, userId, delta }) => {
            try {
                // Check current votes for this user in this retro
                // We need to aggregate all votes by this user for items in this retro
                // Simpler to fetch the user's existing vote directly and adjust it
                // Or just trust client for MVP but better to verify

                // Let's just update the vote
                // Find existing vote
                const existingVote = await db.findVote(itemId, userId);

                if (existingVote) {
                    const newCount = existingVote.count + delta;
                    if (newCount <= 0) {
                        await db.deleteVote(existingVote.id);
                    } else {
                        await db.updateVoteCount(existingVote.id, newCount);
                    }
                } else if (delta > 0) {
                    await db.createVote({ itemId, userId, count: delta });
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
                await db.updateItemSummary(itemId, summary);

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error updating summary:", error);
            }
        });

        socket.on("add-action-item", async ({ retroId, content, assignee, dueDate }) => {
            try {
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
                const action = await db.getActionItem(actionId);
                if (action) {
                    await db.updateActionCompleted(actionId, !action.completed);

                    const updatedRetro = await db.getRetroFull(retroId);
                    io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
                }
            } catch (error) {
                console.error("Error toggling action item:", error);
            }
        });

        socket.on("toggle-reaction", async ({ retroId, itemId, userId, emoji }) => {
            try {
                const existingReaction = await db.findReaction(itemId, userId, emoji);

                if (existingReaction) {
                    await db.deleteReaction(existingReaction.id);
                } else {
                    await db.createReaction({ itemId, userId, emoji });
                }

                const updatedRetro = await db.getRetroFull(retroId);
                io.to(retroId).emit("retro-updated", redactRetroFull(updatedRetro));
            } catch (error) {
                console.error("Error toggling reaction:", error);
            }
        });

        socket.on("move-item", async ({ retroId, itemId, targetColumnId, newIndex }) => {
            try {
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
