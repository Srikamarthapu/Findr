import assert from "node:assert/strict";
import test from "node:test";
import { deleteVerifiedAccount } from "../server/account-service.mjs";

const completeEnv = {
  VITE_SUPABASE_URL: "https://project-ref.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "secret-test",
};

test("account deletion requires every server configuration value", async (t) => {
  for (const missing of Object.keys(completeEnv)) {
    await t.test(`missing ${missing}`, async () => {
      let clientCreations = 0;
      const env = { ...completeEnv };
      delete env[missing];

      const result = await deleteVerifiedAccount({
        authorization: "Bearer valid-token",
        env,
        createClientImpl: () => {
          clientCreations += 1;
          throw new Error("must not create a client");
        },
      });

      assert.equal(result.status, 503);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, "account_service_unavailable");
      assert.equal(clientCreations, 0);
    });
  }
});

test("missing and malformed bearer credentials are unauthorized", async (t) => {
  const invalidHeaders = [
    undefined,
    "",
    "token",
    "Basic abc",
    "Bearer",
    "Bearer first second",
    "Bearer token, Bearer another",
  ];

  for (const authorization of invalidHeaders) {
    await t.test(String(authorization), async () => {
      let clientCreations = 0;
      const result = await deleteVerifiedAccount({
        authorization,
        env: completeEnv,
        createClientImpl: () => {
          clientCreations += 1;
        },
      });

      assert.equal(result.status, 401);
      assert.deepEqual(result.body, {
        ok: false,
        error: {
          code: "unauthorized",
          message: "A valid sign-in is required.",
        },
      });
      assert.equal(clientCreations, 0);
    });
  }
});

test("deletes only the user id returned by getUser", async () => {
  const calls = [];
  const injectedFetch = async () => new Response();
  const createClientImpl = (url, key, options) => {
    calls.push({ url, key, options });
    if (key === completeEnv.VITE_SUPABASE_PUBLISHABLE_KEY) {
      return {
        auth: {
          getUser: async (token) => {
            calls.push({ getUserToken: token });
            return {
              data: { user: { id: "verified-user-id" } },
              error: null,
            };
          },
        },
      };
    }
    if (key === completeEnv.SUPABASE_SECRET_KEY) {
      return {
        auth: {
          admin: {
            deleteUser: async (id, shouldSoftDelete) => {
              calls.push({ deletedId: id, shouldSoftDelete });
              return { data: { user: null }, error: null };
            },
          },
        },
      };
    }
    throw new Error("unexpected key");
  };

  const result = await deleteVerifiedAccount({
    authorization: "Bearer verified-access-token",
    env: completeEnv,
    createClientImpl,
    fetchImpl: injectedFetch,
    userId: "attacker-controlled-id",
  });

  assert.deepEqual(result, {
    status: 200,
    body: { ok: true, deleted: true },
  });
  assert.deepEqual(
    calls.filter((call) => call.getUserToken),
    [{ getUserToken: "verified-access-token" }],
  );
  assert.deepEqual(
    calls.filter((call) => call.deletedId),
    [{ deletedId: "verified-user-id", shouldSoftDelete: false }],
  );
  assert.equal(calls[0].url, completeEnv.VITE_SUPABASE_URL);
  assert.equal(calls[0].options.global.fetch, injectedFetch);
  assert.deepEqual(calls[0].options.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
});

test("verification failure is safe and never creates an admin client", async () => {
  let clientCreations = 0;
  const result = await deleteVerifiedAccount({
    authorization: "Bearer invalid-access-token",
    env: completeEnv,
    createClientImpl: () => {
      clientCreations += 1;
      return {
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: new Error(
              `provider detail ${completeEnv.SUPABASE_SECRET_KEY}`,
            ),
          }),
        },
      };
    },
  });

  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, "unauthorized");
  assert.equal(clientCreations, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /provider detail|secret-test/,
  );
});

test("admin deletion failure returns a safe provider-independent error", async () => {
  const result = await deleteVerifiedAccount({
    authorization: "Bearer valid-access-token",
    env: completeEnv,
    createClientImpl: (_url, key) => {
      if (key === completeEnv.VITE_SUPABASE_PUBLISHABLE_KEY) {
        return {
          auth: {
            getUser: async () => ({
              data: { user: { id: "verified-user-id" } },
              error: null,
            }),
          },
        };
      }
      return {
        auth: {
          admin: {
            deleteUser: async () => ({
              data: { user: null },
              error: new Error(
                `provider detail ${completeEnv.SUPABASE_SECRET_KEY}`,
              ),
            }),
          },
        },
      };
    },
  });

  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    ok: false,
    error: {
      code: "account_deletion_failed",
      message: "Your account could not be deleted. Please try again.",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /provider detail|secret-test/,
  );
});

test("legacy service-role credential remains an admin-key fallback", async () => {
  const env = {
    VITE_SUPABASE_URL: completeEnv.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY:
      completeEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role-test",
  };
  const usedKeys = [];
  const result = await deleteVerifiedAccount({
    authorization: "Bearer valid-access-token",
    env,
    createClientImpl: (_url, key) => {
      usedKeys.push(key);
      if (key === env.VITE_SUPABASE_PUBLISHABLE_KEY) {
        return {
          auth: {
            getUser: async () => ({
              data: { user: { id: "verified-user-id" } },
              error: null,
            }),
          },
        };
      }
      return {
        auth: {
          admin: {
            deleteUser: async () => ({ error: null }),
          },
        },
      };
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(usedKeys, [
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
  ]);
});
