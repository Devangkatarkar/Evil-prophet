// Browser-side SHA-256 hashing using Web Crypto API
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface ManifestItem {
  path: string
  name: string
  sizeBytes: number
  hash: string
}

export async function buildManifest(
  fileList: FileList | File[],
  onProgress?: (done: number, total: number) => void
): Promise<{ manifest: ManifestItem[], skipped: number }> {
  const files = Array.from(fileList)
  const total = files.length
  const manifest: ManifestItem[] = []
  let skipped = 0

  // Process in batches of 8 to avoid blocking the browser
  const BATCH = 8
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          // If it's a directory entry mistakenly included, this will throw
          const buf  = await file.arrayBuffer()
          const hash = await sha256(buf)
          const path = '/' + (file.webkitRelativePath || file.name)
          return { path, name: file.name, sizeBytes: file.size, hash } satisfies ManifestItem
        } catch (err) {
          console.error(`Skipping unreadable file: ${file.name}`, err)
          skipped++
          return null
        }
      })
    )
    manifest.push(...results.filter((r): r is ManifestItem => r !== null))
    onProgress?.(Math.min(i + BATCH, total), total)
    // Yield to browser every batch
    await new Promise(r => setTimeout(r, 0))
  }

  return { manifest, skipped }
}
