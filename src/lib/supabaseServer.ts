import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type SupabaseServerClientResult = {
  client: SupabaseClient | null;
  missingEnvKeys: string[];
  usingServiceRole: boolean;
};

let hasWarnedAnonFallback = false;

function isTemplateValue(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.startsWith("__PUT_") ||
    normalized.includes("PUT_YOUR") ||
    normalized.includes("YOUR_")
  );
}

export function getSupabaseServerClient(): SupabaseServerClientResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const effectiveServiceRoleKey = isTemplateValue(serviceRoleKey)
    ? undefined
    : serviceRoleKey;

  const missingEnvKeys: string[] = [];
  if (!url) {
    missingEnvKeys.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anonKey) {
    missingEnvKeys.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (missingEnvKeys.length > 0) {
    return {
      client: null,
      missingEnvKeys,
      usingServiceRole: false,
    };
  }

  const key = effectiveServiceRoleKey || anonKey;
  const usingServiceRole = Boolean(effectiveServiceRoleKey);

  if (!usingServiceRole && !hasWarnedAnonFallback) {
    console.warn(
      "[supabaseServer] SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to anon key; upsert/sync may fail due to RLS.",
    );
    hasWarnedAnonFallback = true;
  }

  const client = createClient(url as string, key as string, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return {
    client,
    missingEnvKeys: [],
    usingServiceRole,
  };
}
