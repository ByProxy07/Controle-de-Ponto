import test from "node:test";
import assert from "node:assert/strict";
import { createDriverHandler } from "../supabase/functions/driver-auth/handler.mjs";
import {
  validCpf,
  validPin,
  driverEmail,
  driverPassword,
} from "../supabase/functions/_shared/driver-identity.mjs";
const cpf = "52998224725",
  pin = "482951",
  secret = "test-secret-only-".repeat(4);
const uid = "10000000-0000-0000-0000-000000000001";
function fixture(options = {}) {
  const calls = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: !options.limited, error: options.rateError };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: uid,
              role: options.role ?? "admin",
              active: options.active ?? true,
            },
          }),
        }),
      }),
      insert: async (args) => {
        calls.push({ name: table, args });
        return { error: options.auditError };
      },
    }),
    auth: {
      getUser: async () => ({
        data: { user: options.invalidToken ? null : { id: uid } },
      }),
      admin: {
        createUser: async (args) => {
          calls.push({ name: "create", args });
          return { error: options.createError };
        },
        getUserById: async () => ({
          data: {
            user: {
              id: uid,
              email: await driverEmail(secret, cpf),
              app_metadata: { account_kind: options.targetKind ?? "driver" },
            },
          },
        }),
        updateUserById: async (id, args) => {
          calls.push({ name: "update", id, args });
          return {};
        },
      },
    },
  };
  const client = {
    auth: {
      signInWithPassword: async (args) => {
        calls.push({ name: "login", args });
        return options.wrongPin
          ? { error: { message: "internal" } }
          : {
              data: {
                user: {
                  app_metadata: { account_kind: options.kind ?? "driver" },
                },
                session: { access_token: "access", refresh_token: "refresh" },
              },
            };
      },
    },
  };
  const handler = createDriverHandler({
    createClient: (_, key) => (key === "service" ? admin : client),
    env: (name) =>
      ({
        SUPABASE_URL: "https://example.test",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        SUPABASE_ANON_KEY: "anon",
        DRIVER_AUTH_SECRET: options.noSecret ? "" : secret,
      })[name],
  });
  const send = async (body, token) => {
    const result = await handler(
      new Request("https://example.test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: result.status, body: await result.json() };
  };
  return { send, calls };
}
test("CPF check digits and six digit PIN validation", () => {
  assert.ok(validCpf(cpf));
  assert.ok(validCpf("529.982.247-25"));
  for (const v of ["11111111111", "52998224724", "123"])
    assert.equal(validCpf(v), false);
  for (const v of ["123456", "111111", "12", "654321"])
    assert.equal(validPin(v), false);
  assert.ok(validPin(pin));
});
test("opaque stable identity and server derived password", async () => {
  const email = await driverEmail(secret, cpf);
  assert.ok(!email.includes(cpf));
  assert.equal(email, await driverEmail(secret, "529.982.247-25"));
  const password = await driverPassword(secret, email, pin);
  assert.ok(!password.includes(pin));
  assert.ok(password.length > 40);
  assert.notEqual(password, await driverPassword(secret, email, "482952"));
});
test("registration needs no email, confirms Auth, stores no clear CPF or PIN", async () => {
  const { send, calls } = fixture();
  assert.equal(
    (
      await send({
        action: "register",
        cpf,
        pin,
        name: "Motorista Teste",
        role: "admin",
        active: true,
      })
    ).status,
    200,
  );
  const args = calls.find((c) => c.name === "create").args;
  assert.equal(args.email_confirm, true);
  assert.deepEqual(args.app_metadata, { account_kind: "driver" });
  assert.equal(args.user_metadata.cpf_last4, "4725");
  assert.equal(args.user_metadata.role, undefined);
  assert.ok(!JSON.stringify(calls).includes(cpf));
  assert.ok(!JSON.stringify(calls).includes(pin));
});
test("duplicate registration never resets credentials", async () => {
  const { send, calls } = fixture({ createError: { code: "email_exists" } });
  assert.equal(
    (await send({ action: "register", cpf, pin, name: "Motorista Teste" }))
      .status,
    200,
  );
  assert.ok(!calls.some((c) => c.name === "update"));
});
test("login yields only tokens for verified driver account", async () => {
  const { send } = fixture();
  assert.deepEqual((await send({ action: "login", cpf, pin })).body, {
    session: { access_token: "access", refresh_token: "refresh" },
  });
  for (const options of [{ wrongPin: true }, { kind: "team" }])
    assert.equal(
      (await fixture(options).send({ action: "login", cpf, pin })).status,
      401,
    );
});
test("validation and rate limiting prevent authentication requests", async () => {
  for (const [options, body, status] of [
    [{}, { action: "login", cpf: "bad", pin }, 400],
    [{ limited: true }, { action: "login", cpf, pin }, 429],
    [{ rateError: {} }, { action: "login", cpf, pin }, 503],
    [{ noSecret: true }, { action: "login", cpf, pin }, 503],
  ]) {
    const { send, calls } = fixture(options);
    assert.equal((await send(body)).status, status);
    assert.ok(!calls.some((c) => ["login", "create"].includes(c.name)));
  }
});
test("PIN reset requires authenticated active admin and driver target", async () => {
  const body = {
    action: "reset-pin",
    userId: uid,
    pin,
    reason: "Motorista esqueceu seu PIN",
  };
  for (const [options, token, status] of [
    [{}, null, 401],
    [{ invalidToken: true }, "token", 401],
    [{ role: "employee" }, "token", 403],
    [{ active: false }, "token", 403],
    [{ targetKind: "team" }, "token", 400],
    [{ auditError: {} }, "token", 503],
  ]) {
    const { send, calls } = fixture(options);
    assert.equal((await send(body, token)).status, status);
    assert.ok(!calls.some((c) => c.name === "update"));
  }
  const { send, calls } = fixture();
  assert.equal((await send(body, "token")).status, 200);
  assert.ok(
    calls.findIndex((c) => c.name === "audit_events") <
      calls.findIndex((c) => c.name === "update"),
  );
  assert.ok(!JSON.stringify(calls).includes(pin));
});
