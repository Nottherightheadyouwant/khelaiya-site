import { loginAction } from "@/app/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: admin } = await supabase
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (admin) redirect("/admin");
    }
  }

  const messages: Record<string, string> = {
    setup: "Supabase connection keys are not configured yet in .env.local.",
    invalid: "Email or password did not match.",
    "not-admin": "This user account does not have admin permissions in public.admin_users.",
    "rate-limit": "Too many failed login attempts. Please wait 15 minutes before trying again.",
    "mfa-required": "Two-factor authentication (MFA) is required for this admin account.",
  };

  const isSetupError = error === "setup" || !supabase;

  return (
    <main className="login-screen">
      <div className="login-card">
        <Link className="brand" href="/">
          khelaiya<span>.</span>
        </Link>
        <h1>Admin Event Desk</h1>
        <p>Sign in to manage Navratri events, vendor passes, and manual UPI verifications.</p>

        {error && (
          <div className="form-error" role="alert">
            {messages[error] || "Could not sign in."}
          </div>
        )}

        {isSetupError ? (
          <div className="setup-help-box">
            <h3>To connect live Supabase Admin:</h3>
            <ol>
              <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
              <li>Enter your Supabase URL &amp; Anon Key from your Supabase Dashboard.</li>
              <li>Execute <code>supabase/schema.sql</code> in Supabase SQL Editor.</li>
              <li>
                In Supabase <strong>Authentication → Users</strong>, create an admin email, then promote it:
                <pre>
                  {`insert into public.admin_users (user_id)\nselect id from auth.users where email = 'admin@example.com'\non conflict do nothing;`}
                </pre>
              </li>
            </ol>
            <div style={{ marginTop: "16px" }}>
              <Link className="button primary full-width" href="/">
                ← Return to Website Preview
              </Link>
            </div>
          </div>
        ) : (
          <form action={loginAction} className="login-form">
            <label>
              Admin Email
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="admin@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>
            <button className="button primary full-width">Sign in to Admin</button>
            <Link className="back-link" href="/">
              ← Back to events
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
