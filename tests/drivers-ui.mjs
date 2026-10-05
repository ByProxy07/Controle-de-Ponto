import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const preview = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4174",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4174")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CLOCK_TEST_BROWSER
      ? {
          executablePath: process.env.CLOCK_TEST_BROWSER,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        }
      : {}),
  });
  const env = readFileSync(".env", "utf8");
  const url = env
    .match(/^VITE_SUPABASE_URL\s*=\s*(.*)$/m)[1]
    .trim()
    .replace(/^['"]|['"]$/g, "");
  const authKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const id = "20000000-0000-0000-0000-000000000001";
  const profile = {
    id,
    name: "Motorista Teste",
    email: "opaque@motoristas.invalid",
    role: "employee",
    active: false,
    account_kind: "driver",
    cpf_last4: "4725",
    attendance_start: "2000-01-01",
    work_schedule: { daily_target_minutes: 528 },
    created_at: new Date().toISOString(),
  };
  const user = {
    id,
    email: profile.email,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { account_kind: "driver" },
  };
  const token = [
    { alg: "HS256", typ: "JWT" },
    {
      sub: id,
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: "authenticated",
    },
    "signature",
  ]
    .map((v) =>
      Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString(
        "base64url",
      ),
    )
    .join(".");
  const entries = [],
    calls = [],
    errors = [];
  let failRead = false;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: -12.69, longitude: -38.32 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request(),
      address = new URL(req.url());
    if (address.hostname === "127.0.0.1") return route.continue();
    const fulfill = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: { "access-control-allow-origin": "*" },
      });
    if (address.pathname.includes("/functions/v1/driver-auth")) {
      const body = req.postDataJSON();
      calls.push({ name: "driver-auth", args: body });
      return fulfill(
        body.action === "login"
          ? { session: { access_token: token, refresh_token: "mock-refresh" } }
          : {
              message: "Cadastro enviado. Aguarde a liberação do responsável.",
            },
      );
    }
    if (address.pathname.includes("/auth/v1/user")) return fulfill(user);
    if (address.pathname.includes("/auth/v1/logout")) return fulfill({});
    if (address.pathname.endsWith("/profiles")) return fulfill(profile);
    if (address.pathname.endsWith("/time_entries"))
      return failRead
        ? fulfill({ message: "Falha simulada" }, 503)
        : fulfill(entries);
    if (address.pathname.endsWith("/rpc/clock_punch")) {
      const args = req.postDataJSON();
      calls.push({ name: "clock_punch", args });
      const record = {
        id: crypto.randomUUID(),
        user_id: id,
        type: args.p_type,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        voided_at: null,
      };
      entries.push(record);
      return fulfill([record]);
    }
    throw new Error(`Chamada externa não prevista: ${address.pathname}`);
  });
  await page.goto("http://127.0.0.1:4174/motoristas");
  await page.getByRole("button", { name: "ENTRAR", exact: true }).waitFor();
  assert.equal(await page.locator("input[type=email]").count(), 0);
  assert.ok(
    (
      await page
        .getByRole("button", { name: "ENTRAR", exact: true })
        .boundingBox()
    ).height >= 60,
  );
  await page
    .getByRole("button", { name: "Primeira vez? Fazer meu cadastro" })
    .click();
  await page.getByLabel("Nome completo").fill("Motorista Teste");
  await page.getByLabel("Seu CPF").fill("52998224725");
  await page.getByLabel("Seu PIN de 6 números").fill("482951");
  await page.getByLabel("Digite o PIN mais uma vez").fill("482951");
  await page.getByRole("button", { name: "Solicitar meu cadastro" }).click();
  await page
    .getByText("Cadastro enviado. Aguarde a liberação do responsável.", {
      exact: true,
    })
    .waitFor();
  assert.equal(calls[0].args.action, "register");
  assert.equal(calls[0].args.email, undefined);
  console.log("PASS cadastro CPF/PIN sem e-mail");
  async function login() {
    await page.getByLabel("Seu CPF").fill("52998224725");
    await page.getByLabel("Seu PIN de 6 números").fill("482951");
    await page.getByRole("button", { name: "ENTRAR", exact: true }).click();
  }
  await login();
  await page.getByRole("button", { name: "Verificar liberação" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /BATER PONTO:/ }).count(),
    0,
  );
  console.log("PASS motorista inativo aguarda ativação");
  profile.active = true;
  await page.getByRole("button", { name: "Verificar liberação" }).click();
  const punch = page.getByRole("button", {
    name: "BATER PONTO: ENTRADA NO TRABALHO",
    exact: true,
  });
  await punch.waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (e) => e.textContent === "BATER PONTO: ENTRADA NO TRABALHO",
      )?.disabled,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  mkdirSync("tests/screenshots", { recursive: true });
  await page.screenshot({
    path: "tests/screenshots/motorista-ponto.png",
    fullPage: true,
  });
  await punch.click();
  await page
    .getByRole("status")
    .filter({ hasText: "PONTO REGISTRADO" })
    .waitFor();
  assert.equal(calls.filter((c) => c.name === "clock_punch").length, 1);
  const args = calls.find((c) => c.name === "clock_punch").args;
  assert.equal(args.p_type, "entry_1");
  assert.ok(args.p_request_id);
  assert.equal(args.p_timestamp, undefined);
  await page
    .getByText(`Protocolo: ${entries[0].id}`, { exact: true })
    .waitFor();
  console.log(
    "PASS marcação na RPC existente, horário do servidor e protocolo",
  );
  await page.getByRole("button", { name: "Concluir e sair" }).click();
  await page.getByRole("button", { name: "ENTRAR", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Seu CPF").inputValue(), "");
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), authKey),
    null,
  );
  console.log("PASS saída limpa sessão e campos");
  failRead = true;
  await login();
  await page
    .getByText(
      "Não conseguimos conferir seus pontos. Toque em “Tentar novamente”.",
      { exact: true },
    )
    .waitFor();
  assert.ok(
    await page.getByRole("button", { name: /BATER PONTO:/ }).isDisabled(),
  );
  failRead = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (e) => e.textContent === "BATER PONTO: SAÍDA PARA O INTERVALO",
      )?.disabled,
  );
  console.log("PASS falha de leitura bloqueia ponto e permite recuperação");
  await context.setOffline(true);
  await page
    .getByText("Sem internet. Aguarde a conexão para bater ponto.", {
      exact: true,
    })
    .waitFor();
  assert.ok(
    await page.getByRole("button", { name: /BATER PONTO:/ }).isDisabled(),
  );
  await context.setOffline(false);
  console.log("PASS offline não registra nem confirma ponto");
  await page.clock.install();
  await page.getByRole('button',{name:'BATER PONTO: SAÍDA PARA O INTERVALO',exact:true}).click();
  await page.getByRole('status').filter({hasText:'PONTO REGISTRADO'}).waitFor();
  await page.clock.runFor(31000);
  await page.getByRole('button',{name:'ENTRAR',exact:true}).waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),authKey),null);
  console.log('PASS confirmação encerra sessão automaticamente em 30 segundos');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  preview.kill();
}
