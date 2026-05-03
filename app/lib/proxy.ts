/**
 * proxy.ts — Next.js 16 proxy file (replaces middleware.ts).
 *
 * In Next.js 16, this file is the new convention for request interception
 * (previously called middleware.ts). All auth and routing logic lives here.
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

  // Refresh the session (IMPORTANT: must be called before any routing logic)
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
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from the login page
  if (user && isPublicOnly) {
    const next = request.nextUrl.searchParams.get('next') ?? '/dashboard'
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
