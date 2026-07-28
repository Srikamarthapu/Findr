import { createClient } from "@supabase/supabase-js";

const SAFE_ERRORS = {
  unavailable: {
    status: 503,
    code: "account_service_unavailable",
    message: "Account deletion is temporarily unavailable.",
  },
  unauthorized: {
    status: 401,
    code: "unauthorized",
    message: "A valid sign-in is required.",
  },
  deletionFailed: {
    status: 502,
    code: "account_deletion_failed",
    message: "Your account could not be deleted. Please try again.",
  },
};

function safeError({ status, code, message }) {
  return {
    status,
    body: {
      ok: false,
      error: { code, message },
    },
  };
}

function configuredValue(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function readConfig(env) {
  const url = configuredValue(env, ["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  const publishableKey = configuredValue(env, [
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const adminKey = configuredValue(env, [
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);

  if (!url || !publishableKey || !adminKey) return null;
  return { url, publishableKey, adminKey };
}

function bearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^\s*Bearer[ \t]+([^\s,]+)\s*$/i);
  return match?.[1] || null;
}

function clientOptions(fetchImpl) {
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  if (typeof fetchImpl === "function") {
    options.global = { fetch: fetchImpl };
  }
  return options;
}

/**
 * Verifies the caller's bearer token and permanently deletes that verified
 * Supabase Auth user. No caller-supplied user id is accepted or trusted.
 */
export async function deleteVerifiedAccount({
  authorization,
  env = process.env,
  createClientImpl = createClient,
  fetchImpl,
} = {}) {
  const token = bearerToken(authorization);
  if (!token) return safeError(SAFE_ERRORS.unauthorized);

  const config = readConfig(env);
  if (!config || typeof createClientImpl !== "function") {
    return safeError(SAFE_ERRORS.unavailable);
  }

  let verifiedUser;
  try {
    const publicClient = createClientImpl(
      config.url,
      config.publishableKey,
      clientOptions(fetchImpl),
    );
    const { data, error } = await publicClient.auth.getUser(token);
    if (error || typeof data?.user?.id !== "string" || !data.user.id) {
      return safeError(SAFE_ERRORS.unauthorized);
    }
    verifiedUser = data.user;
  } catch {
    return safeError(SAFE_ERRORS.unauthorized);
  }

  try {
    const adminClient = createClientImpl(
      config.url,
      config.adminKey,
      clientOptions(fetchImpl),
    );
    const { error } = await adminClient.auth.admin.deleteUser(
      verifiedUser.id,
      false,
    );
    if (error) return safeError(SAFE_ERRORS.deletionFailed);
  } catch {
    return safeError(SAFE_ERRORS.deletionFailed);
  }

  return {
    status: 200,
    body: {
      ok: true,
      deleted: true,
    },
  };
}
