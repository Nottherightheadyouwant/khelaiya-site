import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MfaStatus {
  hasMfaEnrolled: boolean;
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
}

/**
 * Check the MFA / 2FA status and assurance level of the currently logged-in user.
 */
export async function getMfaAssuranceLevel(supabase: SupabaseClient): Promise<MfaStatus> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) {
      return { hasMfaEnrolled: false, currentLevel: null, nextLevel: null };
    }
    const hasMfaEnrolled = data.nextLevel === "aal2";
    return {
      hasMfaEnrolled,
      currentLevel: data.currentLevel as "aal1" | "aal2" | null,
      nextLevel: data.nextLevel as "aal1" | "aal2" | null,
    };
  } catch {
    return { hasMfaEnrolled: false, currentLevel: null, nextLevel: null };
  }
}

/**
 * Asserts that the authenticated admin session has completed 2FA / MFA (AAL2).
 * If the admin has MFA enrolled but has only authenticated with password (AAL1),
 * this check flags that 2FA challenge is required.
 */
export async function verifyAdminMfa(supabase: SupabaseClient): Promise<{
  verified: boolean;
  requiresMfaVerification: boolean;
}> {
  const mfa = await getMfaAssuranceLevel(supabase);
  if (mfa.hasMfaEnrolled && mfa.currentLevel !== "aal2") {
    return { verified: false, requiresMfaVerification: true };
  }
  return { verified: true, requiresMfaVerification: false };
}
