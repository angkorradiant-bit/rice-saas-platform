import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Grab all cookies to check if they have a VIP wristband (logged in)
  const cookies = request.cookies.getAll();
  const hasAuthCookie = cookies.some(cookie => 
    cookie.name.includes('-auth-token') || cookie.name.includes('supabase')
  );

  const path = request.nextUrl.pathname;

  // RULE 1: If they are NOT logged in, they are blocked.
  // It doesn't matter what link they type, force them to the Login page (/).
  if (!hasAuthCookie) {
    if (
      path.startsWith('/pos') || 
      path.startsWith('/dashboard') || 
      path.startsWith('/settings')
    ) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  // RULE 2: If they ARE logged in and just type your main website name,
  // skip the login screen and drop them right into the POS.
  if (hasAuthCookie && path === '/') {
    return NextResponse.redirect(new URL('/pos', request.url));
  }

  // Otherwise, let them pass normally
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|signup).*)',
  ],
}