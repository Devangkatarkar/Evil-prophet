'use client'
import Image from 'next/image'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import type { Project, FileRecord, Profile, ActivityLog } from '@/lib/types'
import ActivityFeed from '@/components/ActivityFeed'
import DiffDrawer from '@/components/DiffDrawer'
import Toast from '@/components/Toast'
import { formatBytes, formatDistanceToNow, formatISODate } from '@/lib/utils'
import { buildManifest } from '@/lib/hasher'

interface Props {
  project: Project
  userRole: 'owner' | 'member'
  userId: string
  profile: Profile | null
  files: FileRecord[]
  members: (Profile & { role: string })[]
  initialLogs: any[]
}

type ActiveTab = 'files' | 'settings' | 'members'

export default function ProjectClient({ project, userRole, userId, profile, files: initialFiles, members: initialMembers, initialLogs }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('files')
  const [files, setFiles] = useState(initialFiles)
  const [members, setMembers] = useState(initialMembers)
  const [logs, setLogs] = useState(initialLogs)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [hashProgress, setHashProgress] = useState({ done: 0, total: 0 })
  const [uploadStatus, setUploadStatus] = useState('')
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set())
  const [defaultOpenSet, setDefaultOpenSet] = useState(false)
  // Tracks which change-type sections are COLLAPSED: `${sessionId}:${type}`
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())

  function toggleSection(sessionId: string, type: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      const key = `${sessionId}:${type}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function isSectionOpen(sessionId: string, type: string) {
    return !collapsedSections.has(`${sessionId}:${type}`)
  }
  const [scanReport, setScanReport] = useState<{
    added: { path: string; size: number }[]
    modified: { path: string; size: number }[]
    deleted: { path: string }[]
    sessionId: string
    scannedAt: string
  } | null>(null)

  function showToast(msg: string, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function refreshLogs() {
    try {
      const res = await fetch(`/api/projects/${project.id}/logs`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs ?? [])
      }
    } catch { /* silently fail — realtime will catch up */ }
  }

  const initials = (name: string | null | undefined) =>
    (name ?? 'U').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()

  // Real-time subscription — debounced so a 200-file upload triggers one refresh, not 200
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const channel = supabase
      .channel(`project-${project.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `project_id=eq.${project.id}` },
        () => {
          // Debounce: wait 600 ms after the last INSERT before refreshing
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => { refreshLogs() }, 600)
        }
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  // Group logs by session for the activity timeline
  const sessions = useMemo(() => {
    const sessionMap = new Map<string, any[]>()
    logs.forEach(log => {
      if (!sessionMap.has(log.session_id)) sessionMap.set(log.session_id, [])
      sessionMap.get(log.session_id)!.push(log)
    })
    return Array.from(sessionMap.entries()).map(([sid, entries]) => ({
      sessionId: sid,
      createdAt: entries[0].created_at,
      uploader:  entries[0].uploader,
      entries,
    }))
  }, [logs])

  // Open the most recent session by default (client-only to avoid hydration mismatch)
  useEffect(() => {
    if (!defaultOpenSet && sessions.length > 0) {
      setOpenSessions(new Set([sessions[0].sessionId]))
      setDefaultOpenSet(true)
    }
  }, [defaultOpenSet, sessions])

  // ── Upload handler ──────────────────────────────────────────

  async function scanEntries(items: DataTransferItemList) {
    const files: File[] = []
    const queue: FileSystemEntry[] = []

    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry()
      if (entry) queue.push(entry)
    }

    while (queue.length > 0) {
      const entry = queue.shift()!
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
        // Reconstruct the full path
        Object.defineProperty(file, 'webkitRelativePath', {
          value: entry.fullPath.startsWith('/') ? entry.fullPath : '/' + entry.fullPath,
          writable: false
        })
        files.push(file)
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          const results: FileSystemEntry[] = []
          const read = () => {
            reader.readEntries((batch) => {
              if (batch.length === 0) resolve(results)
              else {
                results.push(...batch)
                read()
              }
            }, reject)
          }
          read()
        })
        queue.push(...entries)
      }
    }
    return files
  }

  async function handleFiles(fileList: FileList | File[]) {
    if (!fileList || (fileList instanceof FileList && fileList.length === 0) || (Array.isArray(fileList) && fileList.length === 0) || uploading) return
    const allFiles = Array.isArray(fileList) ? fileList : Array.from(fileList)

    setUploading(true)
    setHashProgress({ done: 0, total: allFiles.length })
    setUploadStatus(`Hashing ${allFiles.length} files…`)

    try {
      const { manifest, skipped } = await buildManifest(allFiles, (done, total) => {
        setHashProgress({ done, total })
      })

      if (skipped > 0) {
        console.warn(`${skipped} files were skipped (unreadable or directories)`)
      }

      setUploadStatus('Detecting changes…')
      const res = await fetch(`/api/projects/${project.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Upload failed')
      }

      const { changes, sessionId } = await res.json()

      if (changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0) {
        // Record an "up to date" sync event in the activity feed
        setUploadStatus('Recording sync…')
        await fetch(`/api/projects/${project.id}/sync-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, fileCount: manifest.length }),
        })
        await new Promise(r => setTimeout(r, 500))
        await refreshLogs()
        setOpenSessions(prev => new Set([...prev, sessionId]))
        showToast('Everything is up to date ✓', 'info')
        setUploading(false)
        setUploadStatus('')
        return
      }

      // Upload changed/new file blobs
      const toUpload = [...changes.added, ...changes.modified]
      let uploaded = 0
      setUploadStatus(`Uploading ${toUpload.length} files…`)

      for (const change of toUpload) {
        const file = allFiles.find(f => {
          const rel = (f.webkitRelativePath || f.name)
          const normalized = rel.startsWith('/') ? rel : '/' + rel
          return normalized === change.path
        })
        if (!file) {
          console.warn(`File not found for path: ${change.path}`)
          continue
        }

        const uploadRes = await fetch(`/api/projects/${project.id}/file-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: change.path, sessionId }),
        })

        if (!uploadRes.ok) {
          console.error(`Failed to get upload URL for ${change.path}`)
          continue
        }

        const { uploadUrl } = await uploadRes.json()

        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        })

        uploaded++
        setUploadStatus(`Uploaded ${uploaded}/${toUpload.length}…`)
      }

      setUploadStatus('Finalizing…')
      await fetch(`/api/projects/${project.id}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      // Show full scan report
      setScanReport({
        added: changes.added,
        modified: changes.modified,
        deleted: changes.deleted,
        sessionId,
        scannedAt: new Date().toISOString(),
      })

      // Auto-open the new session in the feed immediately (optimistic)
      setOpenSessions(prev => new Set([...prev, sessionId]))

      // Give the DB a moment to commit all rows, then pull fresh logs
      // (avoids race between admin insert and anon read)
      await new Promise(r => setTimeout(r, 800))
      await refreshLogs()

      // Auto-open the new session again after logs refresh (sessionId is now in logs)
      setOpenSessions(prev => new Set([...prev, sessionId]))
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error')
      console.error(err)
    } finally {
      setUploading(false)
      setUploadStatus('')
      setHashProgress({ done: 0, total: 0 })
    }
  }

  // ── Invite member ───────────────────────────────────────────

  async function inviteMember() {
    if (!inviteEmail.trim() || inviting) return
    setInviting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(data.message || 'Invitation sent!', 'success')
      setInviteEmail('')
      if (data.member) setMembers(prev => [...prev, data.member])
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setInviting(false)
    }
  }

  // ── Delete project ──────────────────────────────────────────

  async function deleteProject() {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return
    await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    router.replace('/dashboard')
  }

  // ── File tree colors ────────────────────────────────────────

  const knownPaths = new Set(files.map(f => f.file_path))



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
            <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ border: 'none' }}>← Dashboard</Link>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> {uploadStatus}</> : '↑ Upload Folder'}
            </button>
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
                  <div className="pd-item" onClick={() => { setShowProfileMenu(false); router.push('/dashboard') }}>
                    <span>⊞ Dashboard</span>
                  </div>
                  <div className="pd-item pd-item-danger" onClick={async () => { await supabase.auth.signOut(); router.replace('/login') }}>
                    <span>← Sign out</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <input
        ref={fileInputRef}
        type="file"
        // @ts-ignore webkitdirectory is not standard
        webkitdirectory="true"
        multiple
        style={{ display: 'none' }}
        onChange={e => e.target.files && handleFiles(e.target.files)}
      />

      <div className="page-wrap">
        <div className="proj-layout">
          {/* Left panel */}
          <div className="proj-left">
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                <Link href="/dashboard" style={{ color: 'var(--text-secondary)' }}>Dashboard</Link> / {project.name}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em', flex: 1 }}>{project.name}</h1>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-added)', padding: '4px 10px', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 999 }}>
                  <span className="live-dot" /> Live
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="tabs">
              {(['files', 'settings', 'members'] as ActiveTab[]).map(t => (
                <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Files tab */}
            {activeTab === 'files' && (
              <>
                {/* Scan Report — shown after upload */}
                {scanReport && !uploading && (
                  <div className="report-wrap">
                    <div className="report-hd">
                      <h3>✅ Scan Complete — {formatISODate(scanReport.scannedAt)}</h3>
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
                        onClick={() => setScanReport(null)}
                      >✕ Close</button>
                    </div>
                    <div className="report-summary">
                      <div className="report-summary-cell">
                        <div className="report-summary-num" style={{ color: 'var(--color-added)' }}>{scanReport.added.length}</div>
                        <div className="report-summary-label">Added</div>
                      </div>
                      <div className="report-summary-cell">
                        <div className="report-summary-num" style={{ color: 'var(--color-modified)' }}>{scanReport.modified.length}</div>
                        <div className="report-summary-label">Modified</div>
                      </div>
                      <div className="report-summary-cell">
                        <div className="report-summary-num" style={{ color: 'var(--color-deleted)' }}>{scanReport.deleted.length}</div>
                        <div className="report-summary-label">Deleted</div>
                      </div>
                      <div className="report-summary-cell">
                        <div className="report-summary-num" style={{ color: 'var(--accent)' }}>
                          {scanReport.added.length + scanReport.modified.length + scanReport.deleted.length}
                        </div>
                        <div className="report-summary-label">Total</div>
                      </div>
                    </div>
                    {/* Added */}
                    {scanReport.added.length > 0 && (
                      <div className="report-section">
                        <div className="report-section-hd"><span className="cb cb-added">+</span> Added ({scanReport.added.length})</div>
                        {scanReport.added.map((f, i) => (
                          <div key={i} className="report-file">
                            <span className="cb cb-added" style={{ flexShrink: 0 }}>+</span>
                            <span className="report-file-path">{f.path}</span>
                            <span className="report-file-meta">{formatBytes(f.size)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Modified */}
                    {scanReport.modified.length > 0 && (
                      <div className="report-section">
                        <div className="report-section-hd"><span className="cb cb-modified">~</span> Modified ({scanReport.modified.length})</div>
                        {scanReport.modified.map((f, i) => (
                          <div key={i} className="report-file">
                            <span className="cb cb-modified" style={{ flexShrink: 0 }}>~</span>
                            <span className="report-file-path">{f.path}</span>
                            <span
                              className="report-file-diff"
                              onClick={() => setDiffFile(f.path)}
                            >View diff →</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Deleted */}
                    {scanReport.deleted.length > 0 && (
                      <div className="report-section">
                        <div className="report-section-hd"><span className="cb cb-deleted">−</span> Deleted ({scanReport.deleted.length})</div>
                        {scanReport.deleted.map((f, i) => (
                          <div key={i} className="report-file">
                            <span className="cb cb-deleted" style={{ flexShrink: 0 }}>−</span>
                            <span className="report-file-path" style={{ color: 'var(--color-deleted)', textDecoration: 'line-through' }}>{f.path}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Upload zone — hidden while report or uploading shown */}
                {!uploading && !scanReport && (
                  <div
                    className={`upload-zone ${isDragging ? 'dragover' : ''}`}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={async e => {
                      e.preventDefault()
                      setIsDragging(false)
                      if (e.dataTransfer.items) {
                        const files = await scanEntries(e.dataTransfer.items)
                        handleFiles(files)
                      } else if (e.dataTransfer.files) {
                        handleFiles(e.dataTransfer.files)
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span style={{ fontSize: '2.2rem' }}>📂</span>
                    <h3>Drop your project folder here</h3>
                    <p>or click to browse — all file types accepted</p>
                    <button className="btn btn-primary" style={{ pointerEvents: 'none', marginTop: 4 }}>Select Folder</button>
                  </div>
                )}

                {/* Progress */}
                {uploading && (
                  <div className="prog-wrap glass">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span>{uploadStatus}</span>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                        {hashProgress.total > 0 ? `${hashProgress.done}/${hashProgress.total}` : ''}
                      </span>
                    </div>
                    <div className="prog-track">
                      <div
                        className="prog-fill"
                        style={{ width: hashProgress.total > 0 ? `${(hashProgress.done / hashProgress.total) * 100}%` : '100%' }}
                      />
                    </div>
                  </div>
                )}

                {/* File tree */}
                <div className="file-tree">
                  <div className="tree-hd">
                    <h3>📁 Project Files</h3>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{files.length} files</span>
                  </div>
                  <div className="tree-body">
                    {files.length === 0 ? (
                      <div className="empty-state" style={{ padding: '30px 20px' }}>
                        <p>No files yet. Upload your first folder.</p>
                      </div>
                    ) : (
                      files.map(f => (
                        <div
                          key={f.id}
                          className="tree-item"
                          onClick={() => setDiffFile(f.file_path)}
                        >
                          <span style={{ width: 16, textAlign: 'center' }}>📄</span>
                          <span className="tree-path" style={{ color: 'var(--text-secondary)' }}>{f.file_path}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>{formatBytes(f.size_bytes)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Settings tab */}
            {activeTab === 'settings' && (
              <div className="panel">
                <div className="panel-hd"><h3>Project Settings</h3></div>
                <div className="settings-row"><span className="settings-key">Name</span><span className="settings-val">{project.name}</span></div>
                <div className="settings-row"><span className="settings-key">Slug</span><span className="settings-val">{project.slug}</span></div>
                <div className="settings-row"><span className="settings-key">Your role</span><span className="settings-val">{userRole}</span></div>
                <div className="settings-row"><span className="settings-key">Created</span><span className="settings-val">{formatISODate(project.created_at)}</span></div>
                <div className="settings-row"><span className="settings-key">Files tracked</span><span className="settings-val">{files.length}</span></div>
                {userRole === 'owner' && (
                  <div className="settings-row" style={{ borderTop: '1px solid rgba(248,113,113,0.2)' }}>
                    <span className="settings-key" style={{ color: 'var(--color-deleted)' }}>Danger zone</span>
                    <button className="btn btn-danger btn-sm" onClick={deleteProject}>Delete project</button>
                  </div>
                )}
              </div>
            )}

            {/* Members tab */}
            {activeTab === 'members' && (
              <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="panel-hd"><h3>Team Members</h3><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{members.length} members</span></div>
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                  {members.map(m => (
                    <div key={m.id} className="member-item">
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt="" className="avatar" style={{ objectFit: 'cover' }} />
                        : <div className="avatar av-purple">{initials(m.display_name)}</div>
                      }
                      <div className="member-info">
                        <div className="member-name">{m.display_name}</div>
                        <div className="member-email">{m.email}</div>
                      </div>
                      <span className={`badge badge-${m.role}`}>{m.role}</span>
                    </div>
                  ))}
                </div>
                {userRole === 'owner' && (
                  <div className="invite-row" style={{ flexShrink: 0 }}>
                    <input
                      className="input"
                      type="email"
                      placeholder="Invite by email…"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && inviteMember()}
                    />
                    <button className="btn btn-primary btn-sm" onClick={inviteMember} disabled={inviting}>
                      {inviting ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : 'Invite'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel — Activity feed */}
          <div className="right-panel">
            <div className="panel" style={{ flex: 1 }}>
              <div className="panel-hd">
                <h3><span className="live-dot" /> Activity Feed</h3>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Real-time</span>
              </div>
              <div className="panel-body feed-scroll" style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessions.length === 0 ? (
                  <div className="empty-state" style={{ padding: '40px 20px' }}>
                    <div className="empty-state-icon">📋</div>
                    <p>Upload a folder to see changes here.</p>
                  </div>
                ) : (
                  sessions.map((session, i) => {
                    const added    = session.entries.filter((e: any) => e.change_type === 'added').length
                    const modified = session.entries.filter((e: any) => e.change_type === 'modified').length
                    const deleted  = session.entries.filter((e: any) => e.change_type === 'deleted').length
                    const synced   = session.entries.filter((e: any) => e.change_type === 'synced')
                    const isSyncOnly = synced.length > 0 && added === 0 && modified === 0 && deleted === 0
                    const isOpen = openSessions.has(session.sessionId)

                    return (
                      <div key={session.sessionId} className="activity-session">
                        <div
                          className="session-hd"
                          onClick={() => {
                            setOpenSessions(prev => {
                              const next = new Set(prev)
                              if (next.has(session.sessionId)) next.delete(session.sessionId)
                              else next.add(session.sessionId)
                              return next
                            })
                          }}
                        >
                          <div className="avatar av-purple av-sm" style={{ width: 32, height: 32, fontSize: '0.72rem' }}>
                            {initials(session.uploader?.display_name)}
                          </div>
                          <div className="session-info">
                            <div className="session-who">{session.uploader?.display_name ?? 'Unknown'}</div>
                            <div className="session-when" suppressHydrationWarning>{formatDistanceToNow(session.createdAt)}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 5 }}>
                            {isSyncOnly && <span className="chip chip-sync">✓ up to date</span>}
                            {added    > 0 && <span className="chip chip-green">{added} added</span>}
                            {modified > 0 && <span className="chip chip-yellow">{modified} mod</span>}
                            {deleted  > 0 && <span className="chip chip-red">{deleted} del</span>}
                          </div>
                        </div>
                        <div className={`session-body ${isOpen ? 'open' : ''}`}>

                          {/* ─── Synced (up-to-date scan) ─── */}
                          {isSyncOnly && synced.map((entry: any) => (
                            <div key={entry.id} className="feed-item fi-synced" style={{ borderRadius: 0, margin: 0 }}>
                              <span className="cb cb-synced">✓</span>
                              <span className="feed-path" style={{ color: 'var(--color-synced)' }}>{entry.file_path}</span>
                            </div>
                          ))}

                          {/* ─── Added ─── */}
                          {(() => {
                            const entries = session.entries.filter((e: any) => e.change_type === 'added')
                            if (entries.length === 0) return null
                            const open = isSectionOpen(session.sessionId, 'added')
                            return (
                              <div className="cg-section">
                                <div
                                  className="change-group-header cg-added"
                                  onClick={() => toggleSection(session.sessionId, 'added')}
                                  style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                  <span className="cb cb-added" style={{ fontSize: '0.65rem' }}>+</span>
                                  Added
                                  <span className="cg-count">{entries.length} files</span>
                                  <span className="cg-chevron" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                                </div>
                                {open && (
                                  <div className="cg-file-list">
                                    {entries.map((entry: any) => (
                                      <div key={entry.id} className="feed-item fi-added cg-file-row">
                                        <span className="cb cb-added">+</span>
                                        <span className="feed-path">{entry.file_path}</span>
                                        <span className="feed-meta">{entry.file_size ? formatBytes(entry.file_size) : ''}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* ─── Modified ─── */}
                          {(() => {
                            const entries = session.entries.filter((e: any) => e.change_type === 'modified')
                            if (entries.length === 0) return null
                            const open = isSectionOpen(session.sessionId, 'modified')
                            return (
                              <div className="cg-section">
                                <div
                                  className="change-group-header cg-modified"
                                  onClick={() => toggleSection(session.sessionId, 'modified')}
                                  style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                  <span className="cb cb-modified" style={{ fontSize: '0.65rem' }}>~</span>
                                  Modified
                                  <span className="cg-count">{entries.length} files</span>
                                  <span className="cg-chevron" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                                </div>
                                {open && (
                                  <div className="cg-file-list">
                                    {entries.map((entry: any) => (
                                      <div
                                        key={entry.id}
                                        className="feed-item fi-modified cg-file-row"
                                        style={{ cursor: 'pointer' }}
                                        onClick={() => setDiffFile(entry.file_path)}
                                      >
                                        <span className="cb cb-modified">~</span>
                                        <span className="feed-path">{entry.file_path}</span>
                                        <span className="diff-link">View diff →</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                          {/* ─── Deleted ─── */}
                          {(() => {
                            const entries = session.entries.filter((e: any) => e.change_type === 'deleted')
                            if (entries.length === 0) return null
                            const open = isSectionOpen(session.sessionId, 'deleted')
                            return (
                              <div className="cg-section">
                                <div
                                  className="change-group-header cg-deleted"
                                  onClick={() => toggleSection(session.sessionId, 'deleted')}
                                  style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                  <span className="cb cb-deleted" style={{ fontSize: '0.65rem' }}>−</span>
                                  Deleted
                                  <span className="cg-count">{entries.length} files</span>
                                  <span className="cg-chevron" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▾</span>
                                </div>
                                {open && (
                                  <div className="cg-file-list">
                                    {entries.map((entry: any) => (
                                      <div key={entry.id} className="feed-item fi-deleted cg-file-row">
                                        <span className="cb cb-deleted">−</span>
                                        <span className="feed-path" style={{ textDecoration: 'line-through', opacity: 0.7 }}>{entry.file_path}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}

                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {diffFile && (
        <DiffDrawer
          projectId={project.id}
          filePath={diffFile}
          onClose={() => setDiffFile(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </>
  )
}
