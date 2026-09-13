/**
 * (auth) group layout — login/signup/callback pages, statically rendered.
 *
 * Pattern Library reference: Pattern #24 (Magic Link Auth: Complete
 * Implementation). No cookies() or getUser() calls here — auth pages render
 * the same for everyone; session state is handled by middleware and the
 * callback handlers.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
