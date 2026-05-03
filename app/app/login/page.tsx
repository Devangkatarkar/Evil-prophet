'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const supabase = createClient()

  async function signInWithGoogle() {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  return (
    <div className="login-wrap">
      <div className="login-split">

        {/* Left — branding panel (mirrors Arithvoid layout) */}
        <div className="login-left">
          <div className="login-left-brand">
            <div className="brand-cube">◈</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>Evil Prophet</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Folder change detection</div>
            </div>
          </div>

          <div>
            <h1 className="login-left-h1">Welcome back</h1>
            <p className="login-left-desc" style={{ marginTop: 8 }}>
              Access your projects, team activity, and full version history from one secure workspace.
            </p>
          </div>

          <div className="login-features">
            <span className="login-feature-tag">Real-time detection</span>
            <span className="login-feature-tag">Team sharing</span>
            <span className="login-feature-tag">Email alerts</span>
          </div>

          {/* Feature mini cards */}
          <div className="login-feature-icons">
            <div className="feat-mini">
              <div className="feat-mini-icon">📂</div>
              <h4>Personal Projects</h4>
              <p>Track your own folders across devices.</p>
            </div>
            <div className="feat-mini">
              <div className="feat-mini-icon">👥</div>
              <h4>Team Access</h4>
              <p>Collaborate in shared projects with your team.</p>
            </div>
            <div className="feat-mini">
              <div className="feat-mini-icon">📬</div>
              <h4>Notifications</h4>
              <p>Get emailed when files change automatically.</p>
            </div>
          </div>
        </div>

        {/* Right — sign in panel */}
        <div className="login-right">
          <div>
            <p className="login-right-hint">Sign in to continue</p>
            <h2 style={{ fontSize: '1.55rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginTop: 4 }}>
              Open your workspace
            </h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: 6 }}>
              Enter your Google account to access Evil Prophet.
            </p>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button
              className="google-btn"
              onClick={signInWithGoogle}
              disabled={loading}
            >
              {loading ? (
                <div className="spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.1 0 5.6 1.1 7.6 2.8l5.7-5.7C33.8 3.5 29.3 1.5 24 1.5 14.9 1.5 7.2 7.1 4.1 14.9l6.6 5.1C12.3 13.5 17.7 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.8-2.1 5.2-4.4 6.8l6.8 5.3c4-3.7 6.3-9.2 6.3-16.1z"/>
                  <path fill="#FBBC05" d="M10.7 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-6.6-5.2C2.5 17.4 1.5 20.6 1.5 24s1 6.6 2.6 9.7l6.6-5.2z"/>
                  <path fill="#34A853" d="M24 46.5c5.3 0 9.8-1.8 13.1-4.8l-6.8-5.3c-1.8 1.2-4.1 1.9-6.3 1.9-6.3 0-11.7-4-13.3-9.5l-6.6 5.2C7.2 41 14.9 46.5 24 46.5z"/>
                </svg>
              )}
              {loading ? 'Redirecting…' : 'Sign in with Google'}
            </button>
          </div>

          <p className="login-right-footer">
            Access is limited to invited users and workspace members.
          </p>
        </div>

      </div>
    </div>
  )
}
