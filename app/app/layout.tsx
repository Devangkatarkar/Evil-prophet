import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Evil Prophet — See What Changed',
  description: 'Collaborative folder change detection. No Git required.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
