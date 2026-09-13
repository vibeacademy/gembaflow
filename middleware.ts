/**
 * Next.js Middleware entry point — Supabase session refresh + auth guard.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 4. Logic lives in lib/supabase/middleware.ts;
 * this file only wires it up and scopes the matcher.
 *
 * No-ops when Supabase is not configured — see updateSession().
 */
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico, sitemap.xml, robots.txt
     * - /api/health, /api/error, /api/error-events (starter monitoring
     *   endpoints — must stay reachable without a session)
     * - /api/auth/callback (the auth callback itself must not be guarded)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/health|api/error|api/error-events|api/auth/callback).*)",
  ],
};
