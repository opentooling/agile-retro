import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient, Prisma } from '@prisma/client'
import PdfPrinter from 'pdfmake'
import { TDocumentDefinitions } from 'pdfmake/interfaces'

const prisma = new PrismaClient()

type RetroWithRelations = Prisma.RetrospectiveGetPayload<{
    include: {
        columns: {
            include: {
                items: {
                    include: {
                        votes: true
                    }
                }
            }
        },
        actions: true
    }
}>

const fonts = {
    Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params

    try {
        const retro: RetroWithRelations | null = await prisma.retrospective.findUnique({
            where: { id },
            include: {
                columns: {
                    include: {
                        items: {
                            include: {
                                votes: true
                            }
                        }
                    }
                },
                actions: true
            }
        })

        if (!retro) {
            return NextResponse.json({ error: 'Retrospective not found' }, { status: 404 })
        }

        // Extract unique participants from items
        const participants = Array.from(new Set(
            retro.columns.flatMap((col: any) => col.items.map((item: any) => item.username))
        )).sort()

        const printer = new PdfPrinter(fonts)

        const docDefinition: TDocumentDefinitions = {
            content: [
                { text: retro.title, style: 'header' },
                {
                    columns: [
                        { text: `Date: ${retro.createdAt.toLocaleDateString()}`, style: 'subheader' },
                        { text: `Participants: ${participants.length > 0 ? participants.join(', ') : 'None recorded'}`, style: 'subheader', alignment: 'right' }
                    ]
                },


                { text: 'Action Items', style: 'sectionHeader' },
                retro.actions.length > 0
                    ? {
                        ul: retro.actions.map((a: any) => ({
                            text: a.content,
                            color: a.completed ? 'green' : 'black',
                            decoration: a.completed ? 'lineThrough' : undefined
                        }))
                    }
                    : { text: 'No action items recorded.', italics: true, color: 'gray' },

                { text: ' ', margin: [0, 10] }, // Spacer

                // Columns
                ...retro.columns.map((col: any) => {
                    const items = col.items.sort((a: any, b: any) => {
                        const votesA = a.votes.reduce((acc: number, v: any) => acc + v.count, 0)
                        const votesB = b.votes.reduce((acc: number, v: any) => acc + v.count, 0)
                        return votesB - votesA
                    })

                    return [
                        { text: col.title, style: 'columnHeader', margin: [0, 15, 0, 5] },
                        items.length > 0
                            ? items.map((item: any) => {
                                const totalVotes = item.votes.reduce((acc: number, v: any) => acc + v.count, 0)
                                return {
                                    stack: [
                                        {
                                            columns: [
                                                { text: item.content, width: '*' },
                                                { text: totalVotes > 0 ? `Votes: ${totalVotes}` : '', width: 'auto', bold: true, color: '#ca8a04' }
                                            ]
                                        },
                                        { text: `By: ${item.username}`, fontSize: 10, color: 'gray', margin: [0, 2, 0, 0] },
                                        item.summary ? { text: `Notes: ${item.summary}`, fontSize: 10, italics: true, background: '#f3f4f6', margin: [0, 2, 0, 5] } : null,
                                        { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 0.5, lineColor: '#e5e7eb' }], margin: [0, 0, 0, 10] }
                                    ],
                                    margin: [0, 0, 0, 5],
                                    unbreakable: true
                                }
                            })
                            : { text: 'No items.', italics: true, color: 'gray', margin: [0, 0, 0, 10] }
                    ]
                }).flat()
            ],
            styles: {
                header: {
                    fontSize: 22,
                    bold: true,
                    color: '#4f46e5', // Indigo
                    margin: [0, 0, 0, 5]
                },
                subheader: {
                    fontSize: 12,
                    color: '#6b7280'
                },
                sectionHeader: {
                    fontSize: 16,
                    bold: true,
                    color: '#16a34a', // Green
                    margin: [0, 10, 0, 5]
                },
                columnHeader: {
                    fontSize: 14,
                    bold: true,
                    decoration: 'underline',
                    margin: [0, 10, 0, 5]
                }
            },
            defaultStyle: {
                font: 'Roboto'
            }
        }

        const pdfDoc = printer.createPdfKitDocument(docDefinition)

        // Stream the PDF
        const chunks: Uint8Array[] = []
        pdfDoc.on('data', (chunk) => chunks.push(chunk))

        return new Promise<NextResponse>((resolve) => {
            pdfDoc.on('end', () => {
                const result = Buffer.concat(chunks)
                resolve(new NextResponse(result, {
                    headers: {
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': `attachment; filename="${retro.title.replace(/\s+/g, '_')}_report.pdf"`
                    }
                }))
            })
            pdfDoc.end()
        })

    } catch (error) {
        console.error('PDF generation error:', error)
        return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
    }
}
