import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

// GET /api/projects/[projectId]/members — List all members with profile info
export async function GET(
  _request: NextRequest,
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

    // Verify the requesting user is a member
    const { data: selfMembership } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!selfMembership) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Fetch all members
    const { data: memberships, error: memberErr } = await admin
      .from('project_members')
      .select('user_id, role, joined_at')
      .eq('project_id', projectId)
      .order('joined_at', { ascending: true })

    if (memberErr) {
      console.error('[members GET] Failed to fetch memberships:', memberErr)
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ members: [] })
    }

    // Fetch profiles in a single query
    const userIds = memberships.map((m) => m.user_id)
    const { data: profiles, error: profileErr } = await admin
      .from('profiles')
      .select('id, email, display_name, avatar_url')
      .in('id', userIds)

    if (profileErr) {
      console.error('[members GET] Failed to fetch profiles:', profileErr)
      return NextResponse.json({ error: 'Failed to fetch member profiles' }, { status: 500 })
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

    const members = memberships.map((m) => ({
      ...profileMap.get(m.user_id),
      role:      m.role,
      joined_at: m.joined_at,
      isCurrentUser: m.user_id === user.id,
    }))

    return NextResponse.json({ members, yourRole: selfMembership.role })
  } catch (err) {
    console.error('[members GET] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/[projectId]/members — Remove a member (owner only)
// Body: { userId: string }
export async function DELETE(
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

    let body: { userId?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId } = body
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Verify the requesting user is the owner
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
      return NextResponse.json({ error: 'Only the project owner can remove members' }, { status: 403 })
    }

    // Owner cannot remove themselves
    if (userId === user.id) {
      return NextResponse.json({ error: 'You cannot remove yourself from the project' }, { status: 400 })
    }

    // Verify the target is actually a member
    const { data: targetMembership } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single()

    if (!targetMembership) {
      return NextResponse.json({ error: 'User is not a member of this project' }, { status: 404 })
    }

    // Cannot remove another owner (edge case with multiple owners)
    if (targetMembership.role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove a project owner' }, { status: 403 })
    }

    const { error: deleteErr } = await admin
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId)

    if (deleteErr) {
      console.error('[members DELETE] Failed to remove member:', deleteErr)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, removed: userId })
  } catch (err) {
    console.error('[members DELETE] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/projects/[projectId]/members — Update a member's role (owner only)
// Body: { userId: string, role: 'member' | 'editor' }
export async function PATCH(
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

    let body: { userId?: string; role?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId, role } = body
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    if (!role || !['member', 'editor'].includes(role)) {
      return NextResponse.json({ error: "role must be 'member' or 'editor'" }, { status: 400 })
    }

    const admin = createAdminClient()

    // Only owner can change roles
    const { data: selfMembership } = await admin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .single()

    if (!selfMembership || selfMembership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the project owner can change roles' }, { status: 403 })
    }

    const { error: updateErr } = await admin
      .from('project_members')
      .update({ role })
      .eq('project_id', projectId)
      .eq('user_id', userId)

    if (updateErr) {
      console.error('[members PATCH] Failed to update role:', updateErr)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, userId, role })
  } catch (err) {
    console.error('[members PATCH] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
