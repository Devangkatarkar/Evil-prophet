import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

const ONE_HOUR_MS = 60 * 60 * 1000

// POST /api/projects/[projectId]/upload-complete
// Commits file records and sends change notifications to all project members.
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

    let body: { sessionId?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { sessionId } = body
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

    // Fetch the session's activity logs
    const { data: sessionLogs, error: logsErr } = await admin
      .from('activity_logs')
      .select('*')
      .eq('session_id', sessionId)
      .eq('project_id', projectId)

    if (logsErr) {
      console.error('[upload-complete] Failed to fetch session logs:', logsErr)
      return NextResponse.json({ error: 'Failed to read session data' }, { status: 500 })
    }

    if (!sessionLogs || sessionLogs.length === 0) {
      return NextResponse.json({ ok: true, message: 'No changes in this session' })
    }

    // Upsert file records for added/modified
    const toUpsert = sessionLogs
      .filter((l) => l.change_type === 'added' || l.change_type === 'modified')
      .map((l) => ({
        project_id:   projectId,
        file_path:    l.file_path, // stored without leading /
        file_name:    l.file_path.split('/').pop() || l.file_path,
        size_bytes:   l.file_size ?? 0,
        sha256_hash:  l.new_hash ?? '',
        storage_path: `projects/${projectId}/${l.file_path}`, // file_path already has no leading /
        updated_at:   new Date().toISOString(),
        updated_by:   user.id,
      }))

    if (toUpsert.length > 0) {
      const { error: upsertErr } = await admin
        .from('files')
        .upsert(toUpsert, { onConflict: 'project_id,file_path' })

      if (upsertErr) {
        console.error('[upload-complete] File upsert error:', upsertErr)
        return NextResponse.json({ error: 'Failed to commit file records' }, { status: 500 })
      }
    }

    // Send email notifications in the background (non-blocking)
    sendNotificationsBackground(projectId, user.id, sessionLogs, admin)

    return NextResponse.json({ ok: true, committed: toUpsert.length })
  } catch (err) {
    console.error('[upload-complete] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Fires-and-forgets notification emails.
 * Errors here should never fail the HTTP response.
 */
function sendNotificationsBackground(
  projectId: string,
  uploaderId: string,
  logs: Record<string, unknown>[],
  admin: ReturnType<typeof createAdminClient>
): void {
  sendNotifications(projectId, uploaderId, logs, admin).catch((err) =>
    console.error('[notifications] Background error:', err)
  )
}

async function sendNotifications(
  projectId: string,
  uploaderId: string,
  logs: Record<string, unknown>[],
  admin: ReturnType<typeof createAdminClient>
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return

  // ── Fetch project, uploader, and members in parallel ────────────────────────
  const [projectRes, uploaderRes, membersRes] = await Promise.all([
    admin.from('projects').select('name, slug').eq('id', projectId).single(),
    admin.from('profiles').select('display_name, email').eq('id', uploaderId).single(),
    // Use a separate profiles query to avoid the broken embedded join
    admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .neq('user_id', uploaderId),
  ])

  const project  = projectRes.data
  const uploader = uploaderRes.data
  const members  = membersRes.data

  if (!members || members.length === 0) return

  // Fetch profiles for all members in a single query
  const memberIds = members.map((m) => m.user_id)
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, display_name')
    .in('id', memberIds)

  if (!profiles || profiles.length === 0) return

  const added    = logs.filter((l) => l.change_type === 'added').length
  const modified = logs.filter((l) => l.change_type === 'modified').length
  const deleted  = logs.filter((l) => l.change_type === 'deleted').length

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://evil-prophet.vercel.app'

  const fileListHtml = logs
    .slice(0, 12)
    .map((l) => {
      const icon =
        l.change_type === 'added'    ? '&#x2795;' :
        l.change_type === 'modified' ? '&#x007E;' : '&#x2796;'
      const color =
        l.change_type === 'added'    ? '#34d399' :
        l.change_type === 'modified' ? '#fbbf24' : '#f87171'
      return `<span style="color:${color}">${icon} ${String(l.file_path)}</span>`
    })
    .join('<br/>')

  const extraNote =
    logs.length > 12 ? `<br/><span style="color:#888">… and ${logs.length - 12} more file(s)</span>` : ''

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  for (const profile of profiles) {
    if (!profile.email) continue

    // Check per-user rate limit (1 email per project per hour)
    const { data: rateLimit } = await admin
      .from('notification_rate_limits')
      .select('last_sent_at')
      .eq('user_id', profile.id)
      .eq('project_id', projectId)
      .single()

    if (
      rateLimit &&
      Date.now() - new Date(rateLimit.last_sent_at).getTime() < ONE_HOUR_MS
    ) {
      continue
    }

    const subject = `[Evil Prophet] "${project?.name}" updated by ${uploader?.display_name ?? 'a teammate'}`

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:580px;margin:40px auto;padding:28px 32px;background:#0d0d1a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);color:#eee">
        <h2 style="margin:0 0 6px;font-size:1.25rem;font-weight:800;letter-spacing:-0.02em">📁 Project updated</h2>
        <p style="color:#aaa;margin:0 0 22px;font-size:0.95rem">
          <strong style="color:#ddd">${uploader?.display_name ?? 'A teammate'}</strong>
          pushed changes to <strong style="color:#ddd">${project?.name ?? 'your project'}</strong>
        </p>

        <div style="display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap">
          ${added    > 0 ? `<span style="padding:4px 14px;border-radius:999px;background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.25);font-size:0.8rem;font-weight:700">+${added} added</span>` : ''}
          ${modified > 0 ? `<span style="padding:4px 14px;border-radius:999px;background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.25);font-size:0.8rem;font-weight:700">~${modified} modified</span>` : ''}
          ${deleted  > 0 ? `<span style="padding:4px 14px;border-radius:999px;background:rgba(248,113,113,0.12);color:#f87171;border:1px solid rgba(248,113,113,0.25);font-size:0.8rem;font-weight:700">-${deleted} deleted</span>` : ''}
        </div>

        <div style="background:rgba(255,255,255,0.04);padding:14px 16px;border-radius:10px;font-family:monospace;font-size:0.78rem;line-height:1.8;border:1px solid rgba(255,255,255,0.06)">
          ${fileListHtml}${extraNote}
        </div>

        <a href="${appUrl}/project/${project?.slug}"
           style="display:inline-block;margin-top:24px;padding:12px 26px;background:linear-gradient(135deg,#7c5cfc,#9d7cfc);color:#fff;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.9rem;letter-spacing:0.01em">
          View activity feed →
        </a>

        <p style="color:#555;font-size:0.72rem;margin-top:22px;margin-bottom:0">
          You're receiving this because you're a member of <strong>${project?.name}</strong> on Evil Prophet.
          Emails are rate-limited to once per hour per project.
        </p>
      </div>
    `

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? 'notifications@example.com',
        to:   profile.email,
        subject,
        html,
      })

      // Update rate limit record
      await admin.from('notification_rate_limits').upsert(
        {
          user_id:      profile.id,
          project_id:   projectId,
          last_sent_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,project_id' }
      )
    } catch (emailErr) {
      console.error(`[notifications] Failed to send to ${profile.email}:`, emailErr)
    }
  }
}
