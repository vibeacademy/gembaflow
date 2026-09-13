/**
 * Login page — magic-link (email) authentication.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation), File 7. Ported from vibeacademy/website
 * app/(auth)/login/page.tsx (production donor).
 *
 * On form submit, Supabase Auth signInWithOtp sends a magic link to the
 * provided email address. The user clicks the link and is redirected to
 * /api/auth/callback, which exchanges the PKCE code for a session.
 *
 * No passwords are stored — this is a passwordless, magic-link-only flow.
 *
 * Auth decision guardrail: getUser() is always used for session
 * verification, never getSession(). Session validation happens in the
 * callback and middleware, not on this page.
 */
import { MagicLinkForm } from "../magic-link-form";

export default function LoginPage() {
  return (
    <MagicLinkForm
      heading="Log in"
      intro="Enter your email and we'll send you a magic link — no password needed."
      cta="Send magic link"
    />
  );
}
