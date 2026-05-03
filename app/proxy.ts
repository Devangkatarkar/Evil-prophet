/**
 * proxy.ts — Next.js 16 proxy/middleware entry point.
 *
 * Next.js 16 introduced "proxy" as the preferred naming convention
 * for what was previously called "middleware". This file handles all
 * auth routing and session refresh for every incoming request.
 *
 * All logic lives directly here (no separate import needed).
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/dashboard', '/project']
const PUBLIC_ONLY        = ['/login']

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Refresh the auth session before any routing logic.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    console.warn('[proxy] Auth error (non-fatal):', error.message)
  }

  const { pathname } = request.nextUrl

  const isProtected  = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  const isPublicOnly = PUBLIC_ONLY.some((p) => pathname === p)

  // Redirect unauthenticated users away from protected routes
  if (!user && isProtected) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname) // preserve intended destination
    return NextResponse.redirect(loginUrl)
  }

  // Redirect logged-in users away from the login page
  if (user && isPublicOnly) {
    const next = request.nextUrl.searchParams.get('next') ?? '/dashboard'
    // Validate it's a relative path to prevent open-redirect attacks
    const safe = next.startsWith('/') ? next : '/dashboard'
    return NextResponse.redirect(new URL(safe, request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
