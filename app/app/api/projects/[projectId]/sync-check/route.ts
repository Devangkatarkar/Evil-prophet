import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

// POST /api/projects/[projectId]/sync-check
// Inserts a 'synced' activity log entry when a scan finds no changes.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { sessionId?: string; fileCount?: number }
    try { body = await request.json() }
    catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const { sessionId, fileCount = 0 } = body
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
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

    // Insert a single 'synced' log entry for this scan
    const { error: logErr } = await admin.from('activity_logs').insert({
      project_id:  projectId,
      session_id:  sessionId,
      user_id:     user.id,
      change_type: 'synced',
      file_path:   `Scanned ${fileCount} file${fileCount !== 1 ? 's' : ''} — no changes`,
      file_size:   null,
      old_hash:    null,
      new_hash:    null,
    })

    if (logErr) {
      console.error('[sync-check] Failed to insert log:', logErr)
      return NextResponse.json({ error: logErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sync-check] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
