import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { prisma } from "./src/lib/prisma";

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
                const retro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    select: { status: true }
                });

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
                const maxOrderAgg = await prisma.item.aggregate({
                    where: { columnId },
                    _max: { order: true }
                });
                const nextOrder = (maxOrderAgg._max.order ?? -1) + 1;

                await prisma.item.create({
                    data: {
                        content,
                        columnId,
                        userId: userId || "anonymous",
                        username: username || "Anonymous",
                        order: nextOrder
                    }
                });

                // Fetch updated retro
                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    orderBy: { order: 'asc' },
                                    include: { votes: true, reactions: true }
                                }
                            }
                        }
                    }
                });

                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error adding item:", error);
            }
        });

        socket.on("vote", async ({ retroId, itemId, userId, delta }) => {
            try {
                // Check current votes for this user in this retro
                // We need to aggregate all votes by this user for items in this retro
                // This is a bit complex with Prisma relations, simpler to fetch all items and filter
                // Or just trust client for MVP but better to verify

                // Let's just update the vote
                // Find existing vote
                const existingVote = await prisma.vote.findFirst({
                    where: { itemId, userId }
                });

                if (existingVote) {
                    const newCount = existingVote.count + delta;
                    if (newCount <= 0) {
                        await prisma.vote.delete({ where: { id: existingVote.id } });
                    } else {
                        await prisma.vote.update({
                            where: { id: existingVote.id },
                            data: { count: newCount }
                        });
                    }
                } else if (delta > 0) {
                    await prisma.vote.create({
                        data: { itemId, userId, count: delta }
                    });
                }

                // Fetch updated retro and emit
                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    include: { votes: true, reactions: true }
                                }
                            }
                        }
                    }
                });

                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error voting:", error);
            }
        });

        socket.on("update-status", async ({ retroId, status }) => {
            try {
                const updatedRetro = await prisma.retrospective.update({
                    where: { id: retroId },
                    data: {
                        status,
                        phaseStartTime: new Date() // Reset timer on phase change
                    },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    include: { votes: true, reactions: true }
                                }
                            }
                        }
                    }
                });

                // Reset readiness on phase change
                if (participants[retroId]) {
                    Object.keys(participants[retroId]).forEach(socketId => {
                        participants[retroId][socketId].isReady = false;
                    });
                    io.to(retroId).emit("participants-updated", Object.values(participants[retroId]));
                }

                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error updating status:", error);
            }
        });

        socket.on("update-item-summary", async ({ retroId, itemId, summary }) => {
            try {
                await prisma.item.update({
                    where: { id: itemId },
                    data: { summary }
                });

                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    include: { votes: true, reactions: true }
                                }
                            }
                        }
                    }
                });
                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error updating summary:", error);
            }
        });

        socket.on("add-action-item", async ({ retroId, content }) => {
            try {
                await prisma.actionItem.create({
                    data: {
                        content,
                        retrospectiveId: retroId
                    }
                });

                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    include: { votes: true, reactions: true }
                                }
                            }
                        },
                        actions: true
                    }
                });
                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error adding action item:", error);
            }
        });

        socket.on("toggle-reaction", async ({ retroId, itemId, userId, emoji }) => {
            try {
                const existingReaction = await prisma.reaction.findFirst({
                    where: { itemId, userId, emoji }
                });

                if (existingReaction) {
                    await prisma.reaction.delete({ where: { id: existingReaction.id } });
                } else {
                    await prisma.reaction.create({
                        data: { itemId, userId, emoji }
                    });
                }

                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    include: { votes: true, reactions: true }
                                }
                            }
                        },
                        actions: true
                    }
                });
                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error toggling reaction:", error);
            }
        });

        socket.on("move-item", async ({ retroId, itemId, targetColumnId, newIndex }) => {
            try {
                // 1. Get the item to verify it exists and get its current column
                const itemToMove = await prisma.item.findUnique({ where: { id: itemId } });
                if (!itemToMove) return;

                // 2. Update the item's column immediately (if changed)
                if (itemToMove.columnId !== targetColumnId) {
                    await prisma.item.update({
                        where: { id: itemId },
                        data: { columnId: targetColumnId }
                    });
                }

                // 3. Reorder items in the target column
                // Fetch all items in the target column (including the moved one)
                const itemsInColumn = await prisma.item.findMany({
                    where: { columnId: targetColumnId },
                    orderBy: { order: 'asc' }
                });

                // Remove the moved item from the array (if it's there - it might be if we just updated columnId)
                const otherItems = itemsInColumn.filter(i => i.id !== itemId);

                // Insert at new index
                // Clamp index to valid range
                const insertIndex = Math.max(0, Math.min(newIndex, otherItems.length));
                otherItems.splice(insertIndex, 0, { ...itemToMove, columnId: targetColumnId } as any);

                // Update order for all items in the column
                // We use a transaction to ensure consistency
                const updates = otherItems.map((item, index) =>
                    prisma.item.update({
                        where: { id: item.id },
                        data: { order: index }
                    })
                );

                await prisma.$transaction(updates);

                const updatedRetro = await prisma.retrospective.findUnique({
                    where: { id: retroId },
                    include: {
                        columns: {
                            include: {
                                items: {
                                    orderBy: { order: 'asc' },
                                    include: { votes: true, reactions: true }
                                }
                            }
                        },
                        actions: true
                    }
                });
                io.to(retroId).emit("retro-updated", updatedRetro);
            } catch (error) {
                console.error("Error moving item:", error);
            }
        });

        socket.on("disconnect", async () => {
            console.log("Client disconnected", socket.id);
            // Remove user from participants
            for (const retroId in participants) {
                if (participants[retroId][socket.id]) {
                    delete participants[retroId][socket.id];

                    try {
                        const retro = await prisma.retrospective.findUnique({
                            where: { id: retroId },
                            select: { status: true }
                        });

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
