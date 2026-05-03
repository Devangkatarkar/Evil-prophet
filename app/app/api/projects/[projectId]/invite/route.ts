import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import type { MemberRole } from '@/lib/types'

const VALID_INVITE_ROLES: MemberRole[] = ['member', 'editor']

// POST /api/projects/[projectId]/invite
// Body: { email: string, role?: 'member' | 'editor' }
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

    let body: { email?: string; role?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { email, role: rawRole } = body
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Validate role — default to 'member'
    const role: MemberRole = (VALID_INVITE_ROLES as string[]).includes(rawRole ?? '')
      ? (rawRole as MemberRole)
      : 'member'

    const admin = createAdminClient()

    // Only owner can invite
    const { data: selfMembership } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!selfMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (selfMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only project owners can invite members' }, { status: 403 })
    }

    // Don't let the owner invite themselves
    const { data: selfProfile } = await admin
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single()

    if (selfProfile?.email?.toLowerCase() === email.trim().toLowerCase()) {
      return NextResponse.json({ error: "You can't invite yourself" }, { status: 400 })
    }

    // Check if user already exists in the platform
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, display_name, email, avatar_url')
      .ilike('email', email.trim()) // case-insensitive match
      .single()

    if (existingProfile) {
      // Check if already a member
      const { data: alreadyMember } = await admin
        .from('project_members')
        .select('user_id, role')
        .eq('project_id', projectId)
        .eq('user_id', existingProfile.id)
        .single()

      if (alreadyMember) {
        return NextResponse.json(
          { error: `${existingProfile.display_name ?? email} is already a ${alreadyMember.role} of this project` },
          { status: 409 }
        )
      }

      // Add them directly
      const { error: insertErr } = await admin.from('project_members').insert({
        project_id: projectId,
        user_id:    existingProfile.id,
        role,
      })

      if (insertErr) {
        console.error('[invite] Failed to insert member:', insertErr)
        return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
      }

      // Send welcome email
      await sendWelcomeEmail(admin, existingProfile.email, existingProfile.display_name, projectId, user.id, role)

      return NextResponse.json({
        message: `${existingProfile.display_name ?? email} added as a ${role}!`,
        member:  { ...existingProfile, role },
      })
    }

    // User not yet on the platform — store pending invitation
    const { error: invErr } = await admin.from('pending_invitations').upsert(
      { project_id: projectId, email: email.trim().toLowerCase(), invited_by: user.id },
      { onConflict: 'project_id,email' }
    )

    if (invErr && invErr.code !== '23505') {
      console.error('[invite] Failed to store pending invitation:', invErr)
      return NextResponse.json({ error: 'Failed to store invitation' }, { status: 500 })
    }

    // Send invite email
    await sendInviteEmail(admin, email.trim(), projectId, user.id)

    return NextResponse.json({ message: `Invitation sent to ${email.trim()}` })
  } catch (err) {
    console.error('[invite] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function buildEmailWrapper(innerHtml: string): Promise<string> {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:28px 32px;background:#0d0d1a;border-radius:16px;border:1px solid rgba(255,255,255,0.08);color:#eee">
      ${innerHtml}
    </div>
  `
}

async function sendInviteEmail(
  admin: ReturnType<typeof createAdminClient>,
  toEmail: string,
  projectId: string,
  inviterId: string
) {
  if (!process.env.RESEND_API_KEY) return

  const [projectRes, inviterRes] = await Promise.all([
    admin.from('projects').select('name').eq('id', projectId).single(),
    admin.from('profiles').select('display_name').eq('id', inviterId).single(),
  ])

  const project  = projectRes.data
  const inviter  = inviterRes.data
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://evil-prophet.vercel.app'

  const html = await buildEmailWrapper(`
    <h2 style="margin:0 0 6px;font-size:1.2rem;font-weight:800">You're invited 🎉</h2>
    <p style="color:#aaa;margin:0 0 24px;font-size:0.95rem">
      <strong style="color:#ddd">${inviter?.display_name ?? 'Someone'}</strong>
      invited you to collaborate on
      <strong style="color:#ddd">${project?.name ?? 'a project'}</strong> on Evil Prophet.
    </p>
    <a href="${appUrl}/login?next=/dashboard"
       style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#7c5cfc,#9d7cfc);color:#fff;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.9rem">
      Accept invitation →
    </a>
    <p style="color:#555;font-size:0.75rem;margin-top:22px;margin-bottom:0">
      Sign up or log in with <strong>${toEmail}</strong> and you'll automatically get access to the project.
    </p>
  `)

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from:    process.env.RESEND_FROM_EMAIL ?? 'invitations@example.com',
      to:      toEmail,
      subject: `You've been invited to "${project?.name}" on Evil Prophet`,
      html,
    })
  } catch (err) {
    console.error('[invite] Email send failed:', err)
  }
}

async function sendWelcomeEmail(
  admin: ReturnType<typeof createAdminClient>,
  toEmail: string,
  toName: string | null,
  projectId: string,
  inviterId: string,
  role: MemberRole
) {
  if (!process.env.RESEND_API_KEY) return

  const [projectRes, inviterRes] = await Promise.all([
    admin.from('projects').select('name, slug').eq('id', projectId).single(),
    admin.from('profiles').select('display_name').eq('id', inviterId).single(),
  ])

  const project = projectRes.data
  const inviter = inviterRes.data
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://evil-prophet.vercel.app'

  const html = await buildEmailWrapper(`
    <h2 style="margin:0 0 6px;font-size:1.2rem;font-weight:800">You've been added to a project 🚀</h2>
    <p style="color:#aaa;margin:0 0 24px;font-size:0.95rem">
      <strong style="color:#ddd">${inviter?.display_name ?? 'A teammate'}</strong>
      added you to <strong style="color:#ddd">${project?.name ?? 'a project'}</strong>
      as a <strong style="color:#ddd">${role}</strong>.
    </p>
    <a href="${appUrl}/project/${project?.slug}"
       style="display:inline-block;padding:12px 26px;background:linear-gradient(135deg,#7c5cfc,#9d7cfc);color:#fff;border-radius:10px;font-weight:700;text-decoration:none;font-size:0.9rem">
      Open project →
    </a>
    <p style="color:#555;font-size:0.75rem;margin-top:22px;margin-bottom:0">
      Hi ${toName ?? toEmail} — you now have access to this project on Evil Prophet.
    </p>
  `)

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from:    process.env.RESEND_FROM_EMAIL ?? 'invitations@example.com',
      to:      toEmail,
      subject: `You've been added to "${project?.name}" on Evil Prophet`,
      html,
    })
  } catch (err) {
    console.error('[invite] Welcome email failed:', err)
  }
}
