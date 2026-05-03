import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import * as Diff from 'diff'
import type { DiffLine, DiffResult } from '@/lib/types'

// Extensions we can meaningfully diff as text
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'xml', 'svg', 'yaml', 'yml', 'toml', 'env', 'sh', 'bash', 'zsh',
  'bat', 'cmd', 'ps1', 'py', 'rb', 'php', 'java', 'kt', 'kts',
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'cs', 'go', 'rs', 'swift',
  'sql', 'graphql', 'gql', 'prisma', 'proto',
  'gitignore', 'gitattributes', 'dockerfile', 'editorconfig',
  'prettierrc', 'eslintrc', 'babelrc', 'lock',
  'conf', 'ini', 'cfg', 'properties',
])

const MAX_DIFF_SIZE = 200 * 1024 // 200 KB

function isTextFile(path: string): boolean {
  const parts = path.split('.')
  if (parts.length < 2) return false
  const ext = parts.pop()!.toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function sanitizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\.\./g, '').replace(/\/\//g, '/').trim()
}

/**
 * Parse a unified diff string from the `diff` library into structured DiffLine objects.
 * Tracks old and new line numbers accurately.
 */
function parseUnifiedDiff(patch: string): { lines: DiffLine[]; stats: { added: number; deleted: number } } {
  const lines: DiffLine[] = []
  let stats = { added: 0, deleted: 0 }

  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split('\n')) {
    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10)
      newLine = parseInt(hunkMatch[2], 10)
      continue
    }

    // Skip diff header lines
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('\\')) {
      continue
    }

    if (raw.startsWith('+')) {
      lines.push({ type: 'added', content: raw.slice(1), lineNumOld: null, lineNumNew: newLine })
      newLine++
      stats.added++
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'deleted', content: raw.slice(1), lineNumOld: oldLine, lineNumNew: null })
      oldLine++
      stats.deleted++
    } else if (raw.startsWith(' ') || raw === '') {
      // Context line (leading space) or blank
      lines.push({ type: 'context', content: raw.slice(1), lineNumOld: oldLine, lineNumNew: newLine })
      oldLine++
      newLine++
    }
  }

  return { lines, stats }
}

// GET /api/projects/[projectId]/diff?path=/src/foo.ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const filePath = request.nextUrl.searchParams.get('path')
    if (!filePath) {
      return NextResponse.json({ error: 'path query param is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Verify membership
    const { data: membership } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Early exit for binary files
    if (!isTextFile(filePath)) {
      return NextResponse.json({
        lines: [],
        stats: { added: 0, deleted: 0 },
        oldHash: null,
        newHash: null,
        reason: 'binary',
      } satisfies DiffResult)
    }

    const sanitized   = sanitizePath(filePath)
    const currentPath = `projects/${projectId}/${sanitized}`

    // Get the most recent modification log for this file
    const { data: latestLog, error: logErr } = await admin
      .from('activity_logs')
      .select('old_hash, new_hash, change_type')
      .eq('project_id', projectId)
      .eq('file_path', filePath)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (logErr || !latestLog) {
      // No history — show current file as all-added lines
      const { data: blob } = await admin.storage
        .from('project-files')
        .download(currentPath)

      if (!blob) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const text = await blob.text()
      const patch = Diff.createTwoFilesPatch(filePath, filePath, '', text, '', '', { context: 4 })
      const { lines, stats } = parseUnifiedDiff(patch)

      return NextResponse.json({
        lines,
        stats,
        oldHash: null,
        newHash: null,
        reason: 'added',
      } satisfies DiffResult)
    }

    // File was added (no old hash) — show all as added
    if (latestLog.change_type === 'added' || !latestLog.old_hash) {
      const { data: blob } = await admin.storage
        .from('project-files')
        .download(currentPath)

      if (!blob) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const text  = await blob.text()
      const patch = Diff.createTwoFilesPatch(filePath, filePath, '', text, '', '', { context: 4 })
      const { lines, stats } = parseUnifiedDiff(patch)

      return NextResponse.json({
        lines,
        stats,
        oldHash: null,
        newHash: latestLog.new_hash,
        reason: 'added',
      } satisfies DiffResult)
    }

    // File was modified — fetch BOTH old (versioned snapshot) and current
    const versionPath = `versions/${projectId}/${sanitized}@${latestLog.old_hash}`

    const [currentResult, oldResult] = await Promise.all([
      admin.storage.from('project-files').download(currentPath),
      admin.storage.from('project-files').download(versionPath),
    ])

    if (currentResult.error || !currentResult.data) {
      return NextResponse.json({ error: 'Current file not found in storage' }, { status: 404 })
    }

    // Size guard
    if (currentResult.data.size > MAX_DIFF_SIZE) {
      return NextResponse.json({
        lines: [],
        stats: { added: 0, deleted: 0 },
        oldHash: latestLog.old_hash,
        newHash: latestLog.new_hash,
        reason: 'too_large',
      } satisfies DiffResult)
    }

    const currentText = await currentResult.data.text()

    if (oldResult.error || !oldResult.data) {
      // Old snapshot not available — fall back to showing all lines as added
      const patch = Diff.createTwoFilesPatch(filePath, filePath, '', currentText, '', '', { context: 4 })
      const { lines, stats } = parseUnifiedDiff(patch)

      return NextResponse.json({
        lines,
        stats,
        oldHash: latestLog.old_hash,
        newHash: latestLog.new_hash,
        reason: 'no_previous_version',
      } satisfies DiffResult)
    }

    const oldText = await oldResult.data.text()

    // Real two-file diff
    const patch = Diff.createTwoFilesPatch(
      `a/${sanitized}`,
      `b/${sanitized}`,
      oldText,
      currentText,
      '',
      '',
      { context: 4 }
    )

    const { lines, stats } = parseUnifiedDiff(patch)

    return NextResponse.json({
      lines,
      stats,
      oldHash: latestLog.old_hash,
      newHash: latestLog.new_hash,
    } satisfies DiffResult)
  } catch (err) {
    console.error('[diff] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
