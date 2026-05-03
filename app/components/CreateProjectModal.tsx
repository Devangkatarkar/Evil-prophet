'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

interface Props {
  onClose: () => void
  onSuccess: (slug: string) => void
  showToast: (msg: string, type: string) => void
}

export default function CreateProjectModal({ onClose, onSuccess, showToast }: Props) {
  const [name, setName]         = useState('')
  const [description, setDesc]  = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim() }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to create project')
      setLoading(false)
      return
    }

    onSuccess(data.project.slug)
  }

  return (
    <div className="modal-overlay open">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>New Project</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ width: 32, height: 32, padding: 0, justifyContent: 'center' }}>✕</button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: -8 }}>
          Create a project to start tracking folder changes with your team.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label className="label">Project Name *</label>
            <input
              className="input"
              type="text"
              placeholder="e.g. Client Website Q2"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label className="label">Description (optional)</label>
            <input
              className="input"
              type="text"
              placeholder="What is this project for?"
              value={description}
              onChange={e => setDesc(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Creating…</> : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
