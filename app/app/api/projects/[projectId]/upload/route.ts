import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { v4 as uuid } from 'uuid'
import type { ManifestItem } from '@/lib/hasher'

interface UploadBody {
  manifest: ManifestItem[]
}

// Sanitize a file path coming from the client (strip leading slash, no traversal)
function sanitizePath(p: string): string {
  return p
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .replace(/\/\//g, '/')
    .trim()
}

/**
 * Snapshot the current version of a file into the versions bucket so the diff
 * API can later produce a real two-file comparison.
 *
 * Versioned path pattern: versions/{projectId}/{sanitizedPath}@{hash}
 */
async function snapshotFileVersion(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  filePath: string,
  currentHash: string
): Promise<void> {
  try {
    const sanitized = sanitizePath(filePath)
    const src = `projects/${projectId}/${sanitized}`
    const dst = `versions/${projectId}/${sanitized}@${currentHash}`

    // Download current from project-files
    const { data: blob, error: dlErr } = await admin.storage
      .from('project-files')
      .download(src)

    if (dlErr || !blob) {
      console.warn(`[snapshot] Could not download ${src}:`, dlErr?.message)
      return
    }

    // Only snapshot files ≤ 2 MB to avoid storage bloat
    if (blob.size > 2 * 1024 * 1024) return

    const buf = await blob.arrayBuffer()

    // Upload to versions bucket (ignore if already exists — idempotent)
    await admin.storage
      .from('project-files')
      .upload(dst, buf, { upsert: false })
  } catch (err) {
    // Non-fatal: snapshot failure should never block the upload
    console.error('[snapshot] Unexpected error:', err)
  }
}

// POST /api/projects/[projectId]/upload — Change detection engine
export async function POST(
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

    const admin = createAdminClient()

    // Verify membership
    const { data: membership, error: memberErr } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (memberErr || !membership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    let body: UploadBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { manifest } = body
    if (!Array.isArray(manifest) || manifest.length === 0) {
      return NextResponse.json({ error: 'Manifest is required and must be a non-empty array' }, { status: 400 })
    }

    // Validate every item in the manifest
    for (const item of manifest) {
      if (!item.path || typeof item.path !== 'string') {
        return NextResponse.json({ error: 'Each manifest item must have a path string' }, { status: 400 })
      }
      if (!item.hash || typeof item.hash !== 'string' || item.hash.length !== 64) {
        return NextResponse.json({ error: `Invalid hash for file: ${item.path}` }, { status: 400 })
      }
    }

    // Fetch current file state for this project
    const { data: currentFiles, error: fetchErr } = await admin
      .from('files')
      .select('file_path, sha256_hash, id')
      .eq('project_id', projectId)

    if (fetchErr) {
      console.error('[upload] Failed to fetch current files:', fetchErr)
      return NextResponse.json({ error: 'Failed to read project state' }, { status: 500 })
    }

    const currentMap = new Map(
      (currentFiles ?? []).map((f) => [f.file_path, { hash: f.sha256_hash, id: f.id }])
    )

    // ── Normalize incoming paths (strip leading slash) ─────────────────────────
    // The browser always sends paths as "/folder/file.ext".
    // We store them WITHOUT the leading slash so comparisons are stable.
    const normalizedManifest = manifest.map((item) => ({
      ...item,
      path: item.path.replace(/^\/+/, ''),
    }))

    const incomingPaths = new Set(normalizedManifest.map((m) => m.path))

    const added:    ManifestItem[]                          = []
    const modified: (ManifestItem & { oldHash: string })[]  = []
    const deleted:  { path: string }[]                      = []
    const unchanged: string[]                               = []

    // Detect added + modified
    for (const item of normalizedManifest) {
      const existing = currentMap.get(item.path)
      if (!existing) {
        added.push(item)
      } else if (existing.hash !== item.hash) {
        modified.push({ ...item, oldHash: existing.hash })
      } else {
        unchanged.push(item.path)
      }
    }

    // Detect deleted (files in DB but not in incoming manifest)
    for (const [path] of currentMap) {
      if (!incomingPaths.has(path)) {
        deleted.push({ path })
      }
    }

    const sessionId  = uuid()
    const hasChanges = added.length + modified.length + deleted.length > 0

    if (hasChanges) {
      // ── Snapshot old versions of modified files BEFORE we overwrite ──────────
      // Run snapshots concurrently (non-blocking, errors are swallowed inside)
      await Promise.all(
        modified.map((f) =>
          snapshotFileVersion(admin, projectId, f.path, f.oldHash)
        )
      )

      // ── Write activity logs ───────────────────────────────────────────────────
      const logEntries = [
        ...added.map((f) => ({
          project_id:  projectId,
          session_id:  sessionId,
          user_id:     user.id,
          change_type: 'added'    as const,
          file_path:   f.path,          // already normalized (no leading /)
          file_size:   f.sizeBytes,
          new_hash:    f.hash,
        })),
        ...modified.map((f) => ({
          project_id:  projectId,
          session_id:  sessionId,
          user_id:     user.id,
          change_type: 'modified' as const,
          file_path:   f.path,          // already normalized
          file_size:   f.sizeBytes,
          old_hash:    f.oldHash,
          new_hash:    f.hash,
        })),
        ...deleted.map((f) => ({
          project_id:  projectId,
          session_id:  sessionId,
          user_id:     user.id,
          change_type: 'deleted'  as const,
          file_path:   f.path,          // already normalized
        })),
      ]

      const { error: logErr } = await admin.from('activity_logs').insert(logEntries)
      if (logErr) {
        console.error('[upload] Failed to insert activity logs:', logErr)
        return NextResponse.json({ error: 'Failed to record changes' }, { status: 500 })
      }

      // ── Handle deletions ──────────────────────────────────────────────────────
      if (deleted.length > 0) {
        const paths = deleted.map((d) => d.path)
        const { data: toDelete } = await admin
          .from('files')
          .select('id, storage_path')
          .eq('project_id', projectId)
          .in('file_path', paths)

        if (toDelete && toDelete.length > 0) {
          await admin.storage
            .from('project-files')
            .remove(toDelete.map((f) => f.storage_path))

          await admin
            .from('files')
            .delete()
            .eq('project_id', projectId)
            .in('file_path', paths)
        }
      }

      // ── Update project last-modified timestamp ────────────────────────────────
      await admin
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', projectId)
    }

    return NextResponse.json({
      sessionId,
      changes: {
        added,
        modified: modified.map(({ oldHash, ...rest }) => ({ ...rest, oldHash })),
        deleted,
        unchangedCount: unchanged.length,
      },
      hasChanges,
    })
  } catch (err) {
    console.error('[upload] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
