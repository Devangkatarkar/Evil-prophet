'use client'

import { formatDistanceToNow, formatBytes } from '@/lib/utils'

interface Props {
  logs: any[]
  showProject?: boolean
}

function SectionHeader({ type, count }: { type: 'added' | 'modified' | 'deleted'; count: number }) {
  const cfg = {
    added:    { label: 'Added',    icon: '+', cls: 'cb-added',    color: 'var(--color-added)' },
    modified: { label: 'Modified', icon: '~', cls: 'cb-modified', color: 'var(--color-modified)' },
    deleted:  { label: 'Deleted',  icon: '−', cls: 'cb-deleted',  color: 'var(--color-deleted)' },
  }[type]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '6px 12px',
      background: 'var(--bg-2)',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      fontSize: '0.72rem', fontWeight: 700,
      color: cfg.color,
      textTransform: 'uppercase', letterSpacing: '0.07em',
    }}>
      <span className={`cb ${cfg.cls}`} style={{ fontSize: '0.65rem' }}>{cfg.icon}</span>
      {cfg.label}
      <span style={{ marginLeft: 'auto', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>
        {count} file{count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

export default function ActivityFeed({ logs, showProject }: Props) {
  // Group logs by session
  const sessionMap = new Map<string, any[]>()
  logs.forEach(log => {
    if (!sessionMap.has(log.session_id)) sessionMap.set(log.session_id, [])
    sessionMap.get(log.session_id)!.push(log)
  })

  const sessions = Array.from(sessionMap.entries()).map(([sid, entries]) => ({
    sessionId: sid,
    createdAt: entries[0].created_at,
    uploader:  entries[0].uploader,
    project:   entries[0].project,
    synced:    entries.filter((e: any) => e.change_type === 'synced'),
    added:     entries.filter((e: any) => e.change_type === 'added'),
    modified:  entries.filter((e: any) => e.change_type === 'modified'),
    deleted:   entries.filter((e: any) => e.change_type === 'deleted'),
    total:     entries.length,
  }))

  const initials = (name: string | null | undefined) =>
    (name ?? 'U').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sessions.map(session => {
        const isSyncOnly = session.synced.length > 0 &&
          session.added.length === 0 &&
          session.modified.length === 0 &&
          session.deleted.length === 0

        return (
          <div key={session.sessionId} className="activity-session">

            {/* Session header */}
            <div className="session-hd" style={{ cursor: 'default' }}>
              <div className="avatar av-purple av-sm" style={{ width: 32, height: 32, fontSize: '0.72rem', flexShrink: 0 }}>
                {initials(session.uploader?.display_name)}
              </div>
              <div className="session-info">
                <div className="session-who">
                  {session.uploader?.display_name ?? 'Unknown'}
                  {showProject && session.project && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      {' '}in <span style={{ color: 'var(--accent)' }}>{session.project.name}</span>
                    </span>
                  )}
                </div>
                <div className="session-when">{formatDistanceToNow(session.createdAt)}</div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {isSyncOnly && <span className="chip chip-sync">✓ up to date</span>}
                {session.added.length    > 0 && <span className="chip chip-green">{session.added.length} added</span>}
                {session.modified.length > 0 && <span className="chip chip-yellow">{session.modified.length} mod</span>}
                {session.deleted.length  > 0 && <span className="chip chip-red">{session.deleted.length} del</span>}
              </div>
            </div>

            {/* Sync-only row — shown instead of file sections */}
            {isSyncOnly && session.synced.map((entry: any) => (
              <div key={entry.id} className="feed-item fi-synced" style={{ cursor: 'default', borderRadius: 0, marginBottom: 0 }}>
                <span className="cb cb-synced">✓</span>
                <span className="feed-path" style={{ color: 'var(--color-synced)' }}>{entry.file_path}</span>
              </div>
            ))}

            {/* Added section */}
            {session.added.length > 0 && (
              <div>
                <SectionHeader type="added" count={session.added.length} />
                {session.added.map((entry: any) => (
                  <div key={entry.id} className="feed-item fi-added" style={{ cursor: 'default', borderRadius: 0, marginBottom: 0 }}>
                    <span className="cb cb-added">+</span>
                    <span className="feed-path">{entry.file_path}</span>
                    <span className="feed-meta">{entry.file_size ? formatBytes(entry.file_size) : ''}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Modified section */}
            {session.modified.length > 0 && (
              <div>
                <SectionHeader type="modified" count={session.modified.length} />
                {session.modified.map((entry: any) => (
                  <div key={entry.id} className="feed-item fi-modified" style={{ cursor: 'default', borderRadius: 0, marginBottom: 0 }}>
                    <span className="cb cb-modified">~</span>
                    <span className="feed-path">{entry.file_path}</span>
                    <span className="feed-meta" style={{ fontSize: '0.7rem', color: 'var(--color-modified)' }}>changed</span>
                  </div>
                ))}
              </div>
            )}

            {/* Deleted section */}
            {session.deleted.length > 0 && (
              <div>
                <SectionHeader type="deleted" count={session.deleted.length} />
                {session.deleted.map((entry: any) => (
                  <div key={entry.id} className="feed-item fi-deleted" style={{ cursor: 'default', borderRadius: 0, marginBottom: 0 }}>
                    <span className="cb cb-deleted">−</span>
                    <span className="feed-path" style={{ textDecoration: 'line-through', opacity: 0.75 }}>{entry.file_path}</span>
                  </div>
                ))}
              </div>
            )}

          </div>
        )
      })}
    </div>
  )
}
