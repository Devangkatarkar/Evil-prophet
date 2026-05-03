export function formatBytes(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

export function formatDistanceToNow(dateStr: string): string {
  const now  = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = Math.floor((now - then) / 1000)

  if (diff < 60)     return 'Just now'
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`

  // Use explicit ISO-style formatting so server and client always agree.
  // toLocaleDateString() is locale-sensitive and causes SSR hydration mismatches.
  return formatISODate(dateStr)
}

/**
 * Returns a deterministic date string (e.g. "19 Apr 2026") that is
 * identical on both the Node.js server and every browser.
 * Uses UTC so time-zone offsets never shift the displayed day.
 */
export function formatISODate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function generateColor(str: string): string {
  const colors = [
    'linear-gradient(135deg,#7c5cfc,#c05cfc)',
    'linear-gradient(135deg,#34d399,#5c8cfc)',
    'linear-gradient(135deg,#fbbf24,#f87171)',
    'linear-gradient(135deg,#5c8cfc,#34d399)',
    'linear-gradient(135deg,#c05cfc,#7c5cfc)',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash += str.charCodeAt(i)
  return colors[hash % colors.length]
}
