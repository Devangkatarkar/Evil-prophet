import { createServerSupabaseClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Load projects where user is a member
  const { data: memberships } = await supabase
    .from('project_members')
    .select('role, project:projects(*)')
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false })

  const projects = (memberships ?? []).map((m: any) => ({
    ...m.project,
    userRole: m.role,
  }))

  // Load recent activity across all projects
  const projectIds = projects.map((p: any) => p.id)
  let recentActivity: any[] = []
  if (projectIds.length > 0) {
    const { data: logs } = await supabase
      .from('activity_logs')
      .select('*, uploader:profiles!activity_logs_user_id_fkey(id, display_name, avatar_url), project:projects(name, slug)')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(50)
    recentActivity = logs ?? []
  }

  // Stats
  const stats = {
    totalProjects: projects.length,
    totalMembers: 0, // computed below
    changeEvents: recentActivity.length,
  }

  return (
    <DashboardClient
      profile={profile}
      projects={projects}
      recentActivity={recentActivity}
      stats={stats}
    />
  )
}
