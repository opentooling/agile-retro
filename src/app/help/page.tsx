import { readFile } from 'fs/promises'
import path from 'path'
import Link from 'next/link'
import { markdownToHtml } from '@/lib/markdown'

// Read the guide at request time so it always reflects the shipped docs.
export const dynamic = 'force-dynamic'

async function loadGuide(): Promise<string | null> {
  try {
    const md = await readFile(path.join(process.cwd(), 'docs', 'USER_GUIDE.md'), 'utf8')
    return markdownToHtml(md)
  } catch {
    return null
  }
}

export default async function HelpPage() {
  const html = await loadGuide()

  return (
    <div className="container mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Help &amp; User Guide</h1>
        <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </div>

      {html ? (
        <article className="help-content" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-muted-foreground">
          The user guide couldn&apos;t be loaded. See{' '}
          <code>docs/USER_GUIDE.md</code> in the repository.
        </p>
      )}
    </div>
  )
}
