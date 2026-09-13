/**
 * Signup page — magic-link email registration.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation). Ported from vibeacademy/website
 * app/(auth)/signup/page.tsx (production donor).
 *
 * Supabase Auth does not distinguish between signup and login for
 * magic-link flows: signInWithOtp creates the user if they do not exist,
 * or signs in the existing user if they do. This page presents a
 * signup-oriented UI over the same underlying mechanism as the login page.
 *
 * No passwords are stored — passwordless magic-link only.
 */
import { MagicLinkForm } from "../magic-link-form";

export default function SignupPage() {
  return (
    <MagicLinkForm
      heading="Create your account"
      intro="Enter your email and we'll send you a magic link to get started — no password needed."
      cta="Create account"
    />
  );
}
