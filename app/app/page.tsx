import Link from 'next/link'
import Image from 'next/image'

export default function HomePage() {
  return (
    <div className="landing-wrap">

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/" className="nav-brand">
            <Image src="/logo.png" alt="Evil Prophet" height={100} width={300} style={{ objectFit: 'contain' }} priority />
          </Link>
          <div className="nav-right">
            <Link href="/login" className="btn btn-ghost">Sign in</Link>
            <Link href="/login" className="btn btn-primary">Get Started Free</Link>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <div className="hero-pill">
            <span className="live-dot" />
            Zero Git knowledge required
          </div>

          <h1 className="hero-title">
            See what changed.<br />
            <span className="hero-accent">No commit needed.</span>
          </h1>

          <p className="hero-desc">
            Evil Prophet gives your team instant, visual insight into project folder changes.
            Upload a folder — see exactly what was added, modified, or deleted.
          </p>

          <Link href="/login" className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }}>
            Start for free →
          </Link>
        </div>

        {/* Live preview card */}
        <div className="hero-preview">
          <div className="preview-hd">
            <div className="dots">
              <span className="dot dot-r" /><span className="dot dot-y" /><span className="dot dot-g" />
            </div>
            <span className="prev-title">my-project / latest upload</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>2 mins ago</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {[
              { type: 'added', path: '/src/components/Navbar.tsx', meta: '2.1 KB' },
              { type: 'modified', path: '/src/app/page.tsx', meta: 'hash changed' },
              { type: 'modified', path: '/styles/globals.css', meta: 'hash changed' },
              { type: 'deleted', path: '/utils/helpers.js', meta: 'removed' },
            ].map(({ type, path, meta }) => (
              <div key={path} className={`feed-item fi-${type}`} style={{ cursor: 'default' }}>
                <span className={`cb cb-${type}`}>{type === 'added' ? '+' : type === 'modified' ? '~' : '−'}</span>
                <span className="feed-path">{path}</span>
                <span className="feed-meta">{meta}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <span className="chip chip-green">1 added</span>
              <span className="chip chip-yellow">2 modified</span>
              <span className="chip chip-red">1 deleted</span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>by Raju K.</span>
          </div>
        </div>
      </section>

      <section className="features-section">
        <p className="section-label">WHAT YOU GET</p>
        <h2 className="section-title">Everything your team needs to stay in sync</h2>
        <div className="features-grid">
          {features.map(f => (
            <div key={f.title} className="feat-card card">
              <div className="feat-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="features-section" id="how">
        <p className="section-label">HOW IT WORKS</p>
        <h2 className="section-title">Three steps to full visibility</h2>
        <div className="steps-grid">
          {steps.map(s => (
            <div key={s.n} className="step-card card">
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="features-section">
        <div className="card" style={{ textAlign: 'center', padding: '56px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Ready to stop flying blind?</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Get full folder-change visibility for your team in under 2 minutes.</p>
          <Link href="/login" className="btn btn-primary btn-lg">Create your first project →</Link>
        </div>
      </section>

    </div>
  )
}

const features = [
  { icon: '⚡', title: 'Instant Change Detection', desc: 'Browser computes SHA-256 hashes client-side. Only changed files hit the server. Lightning fast even for large folders.' },
  { icon: '👥', title: 'Team Collaboration', desc: 'Invite teammates by email. Real-time activity feed so everyone sees changes as they happen.' },
  { icon: '📬', title: 'Email Notifications', desc: 'Get notified when your project changes. Smart rate-limiting — one email per upload session, max hourly.' },
  { icon: '🔍', title: 'Text Diff on Demand', desc: 'Click any modified text file to see a line-by-line diff in a clean side drawer.' },
  { icon: '🆓', title: '100% Free Tier', desc: 'Built on free infrastructure — Supabase Auth, Storage, Realtime. No credit card required.' },
  { icon: '🔐', title: 'Google Sign-In', desc: 'One-click login via Google OAuth. Sessions managed securely by Supabase JWT.' },
]

const steps = [
  { n: '01', title: 'Create a project', desc: 'Sign in with Google, name your project, invite your teammates by email.' },
  { n: '02', title: 'Upload your folder', desc: 'Drag and drop your project folder. We hash every file in the browser and detect changes instantly.' },
  { n: '03', title: 'See what changed', desc: 'Your activity feed shows exactly what was added, modified, or deleted — in real time for the whole team.' },
]
