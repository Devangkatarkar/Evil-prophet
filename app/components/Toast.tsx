'use client'

export default function Toast({ msg, type }: { msg: string; type: string }) {
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'

  return (
    <div className="toast-wrap">
      <div className={`toast toast-${type}`}>
        <span>{icon}</span>
        <span>{msg}</span>
      </div>
    </div>
  )
}
