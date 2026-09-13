export default function Home() {
  return (
    <main>
      <h1>Agile Flow</h1>
      <p>
        Your deployment pipeline is live. Configure your stack with{" "}
        <code>/bootstrap-architecture</code>.
      </p>

      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>GET /api/health</code> — Health check
        </li>
        <li>
          <code>GET /api/error</code> — Trigger a test error (for Sentry)
        </li>
        <li>
          <code>POST /api/error-events</code> — Error event receiver
        </li>
      </ul>

      <h2>Auth (magic link)</h2>
      <ul>
        <li>
          <a href="/login">/login</a> — Passwordless magic-link sign-in
        </li>
        <li>
          <a href="/signup">/signup</a> — Same flow, signup-oriented copy
        </li>
        <li>
          <a href="/protected">/protected</a> — Example auth-guarded page
        </li>
      </ul>
      <p>
        <small>
          Auth is inert until <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are set — the app builds
          and runs without them. See <code>docs/PATTERN-LIBRARY.md</code> #24.
        </small>
      </p>

      <p>
        <small>
          This is the deploy-first starter. Your tech stack will be configured
          during the bootstrap phase.
        </small>
      </p>
    </main>
  );
}
