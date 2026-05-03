import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase-server'

// POST /api/projects/[projectId]/file-upload
// Returns a signed upload URL for Supabase Storage
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { path, sessionId } = await request.json()
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 })

  // Sanitize path — strip leading slash, collapse ..
  const sanitized = path.replace(/^\/+/, '').replace(/\.\./g, '').replace(/\/\//g, '/')
  const storagePath = `projects/${projectId}/${sanitized}`

  const admin = createAdminClient()

  const { data, error } = await admin.storage
    .from('project-files')
    .createSignedUploadUrl(storagePath)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    uploadUrl: data.signedUrl,
    storagePath,
    token: data.token,
  })
}
