import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

// GET /api/projects/[projectId] — Get project details (members can read)
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

    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({ project: { ...project, userRole: membership.role } })
  } catch (err) {
    console.error('[project GET] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/[projectId] — Delete a project (owner only)
export async function DELETE(
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

    // Verify owner
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (projErr || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (project.owner_id !== user.id) {
      return NextResponse.json({ error: 'Only the owner can delete this project' }, { status: 403 })
    }

    // Delete all storage objects for this project
    const { data: files } = await admin
      .from('files')
      .select('storage_path')
      .eq('project_id', projectId)

    if (files && files.length > 0) {
      await admin.storage
        .from('project-files')
        .remove(files.map((f) => f.storage_path))
    }

    // Also clean up any versioned snapshots (best-effort, non-fatal)
    try {
      const { data: versionedFiles } = await admin.storage
        .from('project-files')
        .list(`versions/${projectId}`, { limit: 1000 })

      if (versionedFiles && versionedFiles.length > 0) {
        await admin.storage
          .from('project-files')
          .remove(versionedFiles.map((f) => `versions/${projectId}/${f.name}`))
      }
    } catch {
      // Non-fatal
    }

    // Cascade delete (DB constraints handle project_members, files, activity_logs)
    const { error: deleteErr } = await admin
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (deleteErr) {
      console.error('[project DELETE] Failed to delete project:', deleteErr)
      return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[project DELETE] Unhandled error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
