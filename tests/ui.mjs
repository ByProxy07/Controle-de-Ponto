import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
const preview = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4173")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CLOCK_TEST_BROWSER ? {executablePath:process.env.CLOCK_TEST_BROWSER,args:['--no-sandbox','--disable-dev-shm-usage']} : {}) });
  const env = readFileSync(".env", "utf8");
  const url = env
    .match(/^VITE_SUPABASE_URL\s*=\s*(.*)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, "");
  if (!url) throw new Error("Missing test configuration");
  const authKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const month = today.slice(0, 7);
  const adminId = "10000000-0000-0000-0000-000000000001";
  const employeeId = "10000000-0000-0000-0000-000000000002";
  const profiles = [
    {
      id: adminId,
      name: "Moisés Teste",
      email: "admin@example.test",
      role: "admin",
      active: true,
      attendance_start: "2000-01-01",
      job_title: "TI",
      work_schedule: { daily_target_minutes: 528 },
      created_at: new Date().toISOString(),
    },
    {
      id: employeeId,
      name: "Colaborador Teste",
      email: "employee@example.test",
      role: "employee",
      active: true,
      attendance_start: "2000-01-01",
      job_title: "Suporte",
      work_schedule: { daily_target_minutes: 528 },
      created_at: new Date().toISOString(),
    },
  ];
  const entries = [];
  profiles.push({...profiles[1],id:'10000000-0000-0000-0000-000000000003',name:'Motorista Teste',email:'opaque@motoristas.invalid',account_kind:'driver',cpf_last4:'4725'});
  let failReads = false;
  const rpcCalls = [];
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: -12.69, longitude: -38.32 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const address = new URL(req.url());
    if (address.hostname === "127.0.0.1") return route.continue();
    // Nenhuma chamada externa alcança o Supabase real, inclusive Auth e Storage.
    const fulfill = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: { "access-control-allow-origin": "*" },
      });
    if (address.pathname.includes("/auth/v1/logout")) return fulfill({});
    if (address.pathname.includes('/functions/v1/driver-auth')) {rpcCalls.push({name:'driver-auth',args:req.postDataJSON()});return fulfill({message:'PIN redefinido.'});}
    if (address.pathname.includes("/auth/v1/user"))
      return fulfill({
        id: adminId,
        email: "admin@example.test",
        aud: "authenticated",
        role: "authenticated",
      });
    if (address.pathname.includes("/rest/v1/rpc/")) {
      const name = address.pathname.split("/").at(-1);
      const args = req.postDataJSON();
      rpcCalls.push({ name, args });
      if (name === "clock_punch") {
        const record = {
          id: crypto.randomUUID(),
          user_id: adminId,
          type: args.p_type,
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString(),
          latitude: args.p_lat,
          longitude: args.p_lng,
          voided_at: null,
        };
        entries.push(record);
        return fulfill([record]);
      }
      return fulfill(null);
    }
    if (failReads && address.pathname.includes("/rest/v1/"))
      return fulfill({ message: "Falha simulada de conexão" }, 503);
    if (address.pathname.endsWith("/profiles")) {
      const id = address.searchParams.get("id");
      return fulfill(id ? profiles.find((p) => `eq.${p.id}` === id) : profiles);
    }
    if (address.pathname.endsWith("/time_entries")) return fulfill(entries);
    if (
      address.pathname.endsWith("/occurrences") ||
      address.pathname.endsWith("/audit_events")
    )
      return fulfill([]);
    return fulfill({ message: "External request blocked by test" }, 400);
  });
  await page.goto("http://127.0.0.1:4173");
  await page.getByRole("button", { name: "Entrar", exact: true }).waitFor();
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await page.getByLabel("Nome completo").waitFor();
  assert.equal(await page.getByText("Coordenador", { exact: true }).count(), 0);
  console.log("PASS cadastro sem escolha de administrador");
  await page.evaluate(
    ({ key, id }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "mock-access-token",
          refresh_token: "mock-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id,
            email: "admin@example.test",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
      );
    },
    { key: authKey, id: adminId },
  );
  await page.reload();
  await page.getByRole("button", { name: "Meu ponto", exact: true }).waitFor();
  await page.getByRole("button", { name: "Meu ponto", exact: true }).click();
  await page
    .getByRole("button", { name: "Entrada Manhã", exact: true })
    .click();
  await page.getByText("Confirmação do registro", { exact: true }).waitFor();
  assert.equal(rpcCalls.filter((c) => c.name === "clock_punch").length, 1);
  assert.equal(rpcCalls[0].args.p_type, "entry_1");
  assert.ok(!("p_timestamp" in rpcCalls[0].args));
  console.log("PASS administrador bate ponto via RPC sem informar horário");
  await page
    .getByRole("button", { name: "Espelho mensal", exact: true })
    .click();
  await page.locator("input[type=month]").fill("2026-09");
  await page
    .getByRole("button", { name: "Exportar Excel", exact: true })
    .waitFor();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exportar Excel", exact: true })
    .click();
  const file = await download;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  const timesheet = workbook.getWorksheet("FOLHA DE PONTO");
  assert.ok(timesheet);
  assert.equal(timesheet.getCell("C7").value, "Moisés Teste");
  assert.equal(timesheet.getCell("C6").value, "TI");
  assert.equal(timesheet.getCell("A51").value.trim(), "Colaborador:");
  console.log("PASS Excel abre no modelo e identifica o colaborador");
  await page.getByRole("button", { name: "Coordenador", exact: true }).click();
  await page.getByRole("button", { name: "Marcações", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Adicionar marcação justificada",
      exact: true,
    })
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByLabel("Justificativa obrigatória")
    .fill("Correção solicitada pelo colaborador");
  await page.getByLabel("Data", { exact: true }).fill("2026-01-05");
  await page
    .getByRole("button", { name: "Salvar com histórico", exact: true })
    .click();
  await page
    .getByText("Ajuste salvo com histórico e justificativa.", { exact: true })
    .waitFor();
  assert.ok(
    rpcCalls.some(
      (c) =>
        c.name === "clock_adjust" &&
        c.args.p_reason === "Correção solicitada pelo colaborador",
    ),
  );
  console.log("PASS ajuste encaminha motivo obrigatório");
  await page
    .getByRole("button", { name: "Colaboradores", exact: true })
    .click();
  await page.getByText("Ativação e cadastro", { exact: true }).waitFor();
  console.log("PASS gestão de colaboradores");
  await page.getByLabel('Grupo',{exact:true}).selectOption('driver');
  await page.getByRole('cell',{name:'CPF final 4725',exact:true}).waitFor();
  assert.equal(await page.getByRole('cell',{name:'Colaborador Teste',exact:true}).count(),0);
  assert.equal(await page.getByText('opaque@motoristas.invalid',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Redefinir PIN',exact:true}).click();
  await page.getByLabel('Novo PIN (6 números)').fill('482951');await page.getByLabel('Confirmar novo PIN').fill('482951');await page.getByLabel('Motivo da redefinição').fill('Motorista esqueceu o PIN');
  await page.getByRole('button',{name:'Salvar novo PIN',exact:true}).click();await page.getByText('PIN redefinido.',{exact:true}).waitFor();
  assert.ok(rpcCalls.some(c=>c.name==='driver-auth'&&c.args.action==='reset-pin'&&c.args.userId===profiles[2].id));
  console.log('PASS filtro de motoristas e redefinição de PIN no painel');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Meu ponto", exact: true }).click();
  await page.getByRole("button", { name: "Solicitações", exact: true }).click();
  await page
    .getByText("Solicitar ajuste ou justificar ausência", { exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  console.log("PASS tela móvel de solicitações sem transbordamento");
  failReads = true;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await page.getByRole("alert").waitFor();
  console.log("PASS erro de consulta aparece na tela");
  assert.deepEqual(errors, []);
  console.log("PASS nenhum erro JavaScript no navegador");
  await context.close();
} finally {
  if (browser) await browser.close();
  preview.kill();
}
