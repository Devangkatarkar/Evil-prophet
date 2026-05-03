'use client'

import { useState, useEffect } from 'react'

interface Props {
  projectId: string
  filePath: string
  onClose: () => void
}

interface DiffLine {
  type: 'added' | 'deleted' | 'context'
  content: string
  lineNum: number
}

export default function DiffDrawer({ projectId, filePath, onClose }: Props) {
  const [lines, setLines]     = useState<DiffLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    async function loadDiff() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/projects/${projectId}/diff?path=${encodeURIComponent(filePath)}`)
        if (!res.ok) {
          const e = await res.json()
          throw new Error(e.error || 'Could not load diff')
        }
        const data = await res.json()
        setLines(data.lines)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadDiff()
  }, [projectId, filePath])

  return (
    <>
      <div className="diff-overlay open" onClick={onClose} />
      <div className="diff-drawer open">
        <div className="drawer-hd">
          <h3>{filePath}</h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ padding: '4px 10px', minWidth: 'auto' }}
          >✕</button>
        </div>
        <div className="drawer-body">
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div className="spinner" />
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
          {!loading && !error && lines.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">✓</div>
              <p>No text diff available for binary files.</p>
            </div>
          )}
          {!loading && !error && lines.length > 0 && (
            <div className="diff-content">
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={`diff-line ${line.type === 'added' ? 'diff-added' : line.type === 'deleted' ? 'diff-deleted' : ''}`}
                >
                  <span className="diff-num">{line.lineNum}</span>
                  <span className="diff-text">
                    {line.type === 'added' ? '+ ' : line.type === 'deleted' ? '- ' : '  '}{line.content}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
