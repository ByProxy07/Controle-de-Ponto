import {
  normalizeCpf,
  validCpf,
  validPin,
  digest,
  driverEmail,
  driverPassword,
} from "../_shared/driver-identity.mjs";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const response = (body, status = 200) =>
  Response.json(body, { status, headers });
export function createDriverHandler({ createClient, env }) {
  return async function handler(request) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return response({ error: "Método não permitido." }, 405);
    const url = env("SUPABASE_URL"),
      key = env("SUPABASE_SERVICE_ROLE_KEY"),
      anon = env("SUPABASE_ANON_KEY"),
      secret = env("DRIVER_AUTH_SECRET");
    if (!url || !key || !anon || !secret || secret.length < 32)
      return response(
        {
          error:
            "Acesso de motoristas ainda não configurado. Avise o responsável.",
        },
        503,
      );
    try {
      if (Number(request.headers.get("content-length") || 0) > 4096)
        return response({ error: "Requisição inválida." }, 400);
      const text = await request.text();
      if (text.length > 4096)
        return response({ error: "Requisição inválida." }, 400);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return response({ error: "Requisição inválida." }, 400);
      }
      if (
        !body ||
        typeof body !== "object" ||
        !["register", "login", "reset-pin"].includes(body.action)
      )
        return response({ error: "Operação inválida." }, 400);
      // Um cliente por requisição. Nenhuma sessão ou chave administrativa chega ao frontend.
      const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const limited = async (bucket, limit, seconds = 900) => {
        const { data, error } = await admin.rpc("driver_take_attempt", {
          p_key: bucket,
          p_limit: limit,
          p_seconds: seconds,
        });
        if (error) throw new Error("RATE_STORE_UNAVAILABLE");
        return data === true;
      };
      if (body.action === "reset-pin") {
        const token = request.headers
          .get("authorization")
          ?.replace(/^Bearer\s+/i, "");
        if (!token)
          return response({ error: "Entre como administrador." }, 401);
        const { data: auth, error: authError } =
          await admin.auth.getUser(token);
        if (authError || !auth?.user)
          return response(
            { error: "Entre novamente como administrador." },
            401,
          );
        const { data: actor, error: actorError } = await admin
          .from("profiles")
          .select("id,role,active")
          .eq("id", auth.user.id)
          .single();
        if (actorError || !actor?.active || actor.role !== "admin")
          return response({ error: "Acesso restrito ao administrador." }, 403);
        if (
          !validPin(body.pin) ||
          !/^.{5,1000}$/s.test(body.reason ?? "") ||
          !/^[-a-f0-9]{36}$/i.test(body.userId ?? "")
        )
          return response(
            {
              error:
                "Informe PIN de 6 números não sequenciais e motivo com pelo menos 5 caracteres.",
            },
            400,
          );
        if (!(await limited("reset:" + auth.user.id, 20)))
          return response(
            { error: "Muitas tentativas. Aguarde 15 minutos." },
            429,
          );
        const { data: target, error: targetError } =
          await admin.auth.admin.getUserById(body.userId);
        if (
          targetError ||
          target?.user?.app_metadata?.account_kind !== "driver"
        )
          return response({ error: "Conta de motorista não encontrada." }, 400);
        // Registrar a solicitação antes de alterar a credencial. PIN/senha nunca entram na auditoria.
        const { error: auditError } = await admin
          .from("audit_events")
          .insert({
            actor_id: auth.user.id,
            entity: "profiles",
            entity_id: body.userId,
            subject_id: body.userId,
            action: "driver_pin_reset_requested",
            reason: body.reason,
          });
        if (auditError) throw new Error("AUDIT_UNAVAILABLE");
        const password = await driverPassword(
          secret,
          target.user.email,
          body.pin,
        );
        const { error } = await admin.auth.admin.updateUserById(body.userId, {
          password,
        });
        if (error)
          return response(
            { error: "Não foi possível redefinir o PIN. Tente novamente." },
            503,
          );
        return response({
          ok: true,
          message:
            "PIN redefinido. Entregue-o somente ao motorista, após conferir sua identidade.",
        });
      }
      const cpf = normalizeCpf(body.cpf);
      if (!validCpf(cpf))
        return response({ error: "Confira os 11 números do CPF." }, 400);
      if (!validPin(body.pin))
        return response(
          {
            error:
              "Use um PIN de 6 números. Evite números repetidos ou sequências como 123456.",
          },
          400,
        );
      const email = await driverEmail(secret, cpf);
      // Limite principal por CPF funciona mesmo se o IP variar. IP é somente proteção adicional.
      if (!(await limited("cpf:" + (await digest(secret, cpf)), 8)))
        return response(
          { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
          429,
        );
      const ip =
        request.headers.get("x-real-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0] ||
        "unknown";
      if (!(await limited("ip:" + (await digest(secret, ip)), 120)))
        return response(
          { error: "Muitas tentativas nesta conexão. Aguarde 15 minutos." },
          429,
        );
      const password = await driverPassword(secret, email, body.pin);
      if (body.action === "register") {
        const name = String(body.name ?? "").trim(),
          company = String(body.company ?? "").trim();
        if (name.length < 3 || name.length > 120 || company.length > 120)
          return response(
            { error: "Informe seu nome completo (3 a 120 caracteres)." },
            400,
          );
        const { error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: { account_kind: "driver" },
          user_metadata: {
            name,
            cpf_last4: cpf.slice(-4),
            driver_company: company,
          },
        });
        if (
          error &&
          !["email_exists", "user_already_exists"].includes(error.code)
        )
          return response(
            {
              error:
                "Não foi possível concluir o cadastro. Peça ajuda ao responsável.",
            },
            503,
          );
        // Mesma resposta para cadastro repetido; nunca substitui senha/perfil de conta existente.
        return response({
          ok: true,
          message:
            "Se este CPF ainda não tinha cadastro, sua solicitação foi enviada. Entre com seu PIN e aguarde a liberação do responsável. Se já tinha cadastro, use o PIN anterior.",
        });
      }
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (
        error ||
        !data?.session ||
        data.user?.app_metadata?.account_kind !== "driver"
      )
        return response(
          { error: "CPF ou PIN incorretos. Confira e tente novamente." },
          401,
        );
      // Acesso aos registros continua protegido por active + auth.uid() no banco.
      return response({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
      });
    } catch {
      // Não registrar corpo da requisição: contém CPF/PIN.
      return response(
        {
          error:
            "Serviço temporariamente indisponível. Tente novamente ou avise o responsável.",
        },
        503,
      );
    }
  };
}
