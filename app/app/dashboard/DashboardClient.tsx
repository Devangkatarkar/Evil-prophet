'use client'
import Image from 'next/image'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { Profile, Project } from '@/lib/types'
import ActivityFeed from '@/components/ActivityFeed'
import CreateProjectModal from '@/components/CreateProjectModal'
import Toast from '@/components/Toast'
import { formatDistanceToNow } from '@/lib/utils'

interface Props {
  profile: Profile | null
  projects: (Project & { userRole: string })[]
  recentActivity: any[]
  stats: { totalProjects: number; totalMembers: number; changeEvents: number }
}

export default function DashboardClient({ profile, projects, recentActivity, stats }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [showModal, setShowModal] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)

  function showToast(msg: string, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const initials = (name: string | null) =>
    (name ?? 'U').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      <div className="bg-orbs">
        <div className="orb orb-1" /><div className="orb orb-2" /><div className="orb orb-3" />
      </div>

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/dashboard" className="nav-brand">
            <Image src="/logo.png" alt="Evil Prophet" height={100} width={300} style={{ objectFit: 'contain' }} priority />
          </Link>
          <div className="nav-right">
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>+ New Project</button>
            <div className="profile-menu-container">
              <div
                className="avatar av-purple"
                title={profile?.display_name ?? ''}
                style={{ cursor: 'pointer' }}
                onClick={() => setShowProfileMenu(!showProfileMenu)}
              >
                {initials(profile?.display_name ?? null)}
              </div>
              {showProfileMenu && (
                <div className="profile-dropdown">
                  <div className="pd-header">
                    <div className="pd-name">{profile?.display_name ?? 'User'}</div>
                    <div className="pd-email">{profile?.email ?? ''}</div>
                  </div>
                  <div className="pd-item" onClick={() => { setShowProfileMenu(false); /* Navigate to settings if it existed */ }}>
                    <span>⚙ Settings</span>
                  </div>
                  <div className="pd-item pd-item-danger" onClick={signOut}>
                    <span>← Sign out</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <div className="page-wrap">
        <div className="dash-layout">
          <main className="main">
            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card glass">
                <div className="stat-label">Total Projects</div>
                <div className="stat-value">{stats.totalProjects}</div>
                <div className="stat-sub">across your account</div>
              </div>
              <div className="stat-card glass">
                <div className="stat-label">Change Events</div>
                <div className="stat-value">{stats.changeEvents}</div>
                <div className="stat-sub">all time</div>
              </div>
            </div>

            {/* Projects */}
            <div className="sec-head">
              <h2>Your Projects</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(true)}>+ New project</button>
            </div>

            <div className="projects-grid">
              {projects.map(p => (
                <Link key={p.id} href={`/project/${p.slug}`} className="proj-card glass">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div className="proj-name">{p.name}</div>
                      <div className="proj-slug">{p.slug}</div>
                    </div>
                    <span className={`badge badge-${p.userRole}`}>{p.userRole}</span>
                  </div>
                  <p className="proj-desc">{p.description || 'No description.'}</p>
                  <div className="proj-meta">
                    <span>Updated {formatDistanceToNow(p.updated_at)}</span>
                  </div>
                </Link>
              ))}

              <button className="create-card glass" onClick={() => setShowModal(true)} style={{ background: 'transparent' }}>
                <span style={{ fontSize: '1.6rem', opacity: 0.4 }}>+</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Create new project</span>
              </button>
            </div>

            {/* Activity */}
            <div className="sec-head">
              <h2>Recent Activity</h2>
            </div>

            {recentActivity.length === 0 ? (
              <div className="empty-state glass" style={{ borderRadius: 'var(--radius-lg)' }}>
                <div className="empty-state-icon">📂</div>
                <p>No activity yet. Upload a folder to your first project to get started.</p>
              </div>
            ) : (
              <ActivityFeed logs={recentActivity} showProject />
            )}
          </main>
        </div>
      </div>

      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onSuccess={(slug) => {
            setShowModal(false)
            showToast('Project created!', 'success')
            router.push(`/project/${slug}`)
          }}
          showToast={showToast}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </>
  )
}
