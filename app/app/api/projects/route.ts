import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'
import { slugify } from '@/lib/utils'
import { v4 as uuid } from 'uuid'

// GET /api/projects — List all projects the authenticated user is a member of
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createAdminClient()

    const { data: memberships, error: memberErr } = await admin
      .from('project_members')
      .select('role, joined_at, project_id')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: false })

    if (memberErr) {
      console.error('[projects GET] Failed to fetch memberships:', memberErr)
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 })
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ projects: [] })
    }

    const projectIds = memberships.map((m) => m.project_id)

    const { data: projects, error: projErr } = await admin
      .from('projects')
      .select('*')
      .in('id', projectIds)
      .order('updated_at', { ascending: false })

    if (projErr) {
      console.error('[projects GET] Failed to fetch project details:', projErr)
      return NextResponse.json({ error: 'Failed to fetch project details' }, { status: 500 })
    }

    // Merge role into each project object
    const roleMap = new Map(memberships.map((m) => [m.project_id, m.role]))
    const result = (projects ?? []).map((p) => ({
      ...p,
      userRole: roleMap.get(p.id) ?? 'member',
    }))

    return NextResponse.json({ projects: result })
  } catch (err) {
    console.error('[projects GET] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects — Create a new project
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { name?: string; description?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { name, description } = body
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const slug  = slugify(name.trim())
    const id    = uuid()

    // Create project
    const { data: project, error: projErr } = await admin
      .from('projects')
      .insert({
        id,
        name:        name.trim(),
        slug,
        description: description?.trim() || null,
        owner_id:    user.id,
      })
      .select()
      .single()

    if (projErr) {
      if (projErr.code === '23505') {
        // Slug conflict — append a random 4-char suffix
        const newSlug = `${slug}-${Math.random().toString(36).slice(2, 6)}`
        const { data: p2, error: e2 } = await admin
          .from('projects')
          .insert({
            id,
            name:        name.trim(),
            slug:        newSlug,
            description: description?.trim() || null,
            owner_id:    user.id,
          })
          .select()
          .single()

        if (e2) {
          console.error('[projects POST] Retry insert failed:', e2)
          return NextResponse.json({ error: e2.message }, { status: 500 })
        }

        await admin.from('project_members').insert({
          project_id: p2!.id,
          user_id:    user.id,
          role:       'owner',
        })

        return NextResponse.json({ project: p2 }, { status: 201 })
      }

      console.error('[projects POST] Insert failed:', projErr)
      return NextResponse.json({ error: projErr.message }, { status: 500 })
    }

    // Add owner as member
    const { error: memberErr } = await admin.from('project_members').insert({
      project_id: project!.id,
      user_id:    user.id,
      role:       'owner',
    })

    if (memberErr) {
      console.error('[projects POST] Failed to add owner as member:', memberErr)
      // Project was created — don't fail the whole request, but log it
    }

    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    console.error('[projects POST] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
