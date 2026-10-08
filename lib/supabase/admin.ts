import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyAdminMfa } from "@/lib/security/mfa";

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/admin/login?error=setup");

  // Re-verify the authenticated user cryptographically with the Supabase Auth server
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/admin/login");
  }

  // Enforce server-side authorization check against public.admin_users
  const { data: admin, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (adminError || !admin) {
    redirect("/admin/login?error=not-admin");
  }

  // Verify MFA assurance level if enrolled
  const { verified: mfaVerified, requiresMfaVerification } = await verifyAdminMfa(supabase);
  if (requiresMfaVerification && !mfaVerified) {
    redirect("/admin/login?error=mfa-required");
  }

  return { supabase, user };
}
