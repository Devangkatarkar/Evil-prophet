import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import ProjectClient from './ProjectClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 1. Fetch the project by slug
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('*')
    .eq('slug', slug)
    .single()

  if (projErr || !project) {
    console.error(`[ProjectPage] Error fetching project (slug: ${slug}):`, projErr)
    notFound()
  }

  // 2. Verify current user's membership in this project
  const { data: membership, error: memberErr } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', project.id)
    .eq('user_id', user.id)
    .single()

  if (memberErr || !membership) {
    console.error(`[ProjectPage] Access denied for user ${user.id} on project ${project.id}:`, memberErr)
    notFound()
  }

  // Fetch files
  const { data: files } = await supabase
    .from('files')
    .select('*')
    .eq('project_id', project.id)
    .order('file_path')

  // Fetch members
  const { data: members } = await supabase
    .from('project_members')
    .select('role, profile:profiles(*)')
    .eq('project_id', project.id)

  // Fetch activity logs (last 200)
  const { data: logs } = await supabase
    .from('activity_logs')
    .select('*, uploader:profiles!activity_logs_user_id_fkey(id, display_name, avatar_url)')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .limit(200)

  // Fetch current user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <ProjectClient
      project={project}
      userRole={membership.role as 'owner' | 'member'}
      userId={user.id}
      profile={profile}
      files={files ?? []}
      members={(members ?? []).map((m: any) => ({ ...m.profile, role: m.role }))}
      initialLogs={logs ?? []}
    />
  )
}
