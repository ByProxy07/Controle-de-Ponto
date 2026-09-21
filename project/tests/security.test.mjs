import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
// PostgreSQL real em WASM; schemas Auth/Storage mínimos simulados, sem conexão externa.
test("database permissions and workflows", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated;
 CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array($1,'/') $$;`);
  const migrations = [
    "20260916141314_create_time_clock_schema.sql",
    "20260916142432_fix_rls_recursion_and_self_insert.sql",
    "20260921120000_secure_time_clock.sql",
  ];
  for (const f of migrations)
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  const [emp, other, admin, inactive] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  for (const [i, id] of [emp, other, admin, inactive].entries())
    await db.query(
      "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",
      [
        id,
        `user${i}@example.test`,
        { name: `User ${i}`, role: "admin", active: true },
      ],
    );
  const run = async (id, sql, params = []) =>
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        id,
      ]);
      return tx.query(sql, params);
    });
  const deny = (id, sql, params = []) =>
    assert.rejects(() => run(id, sql, params));
  await t.test(
    "signup ignores supplied admin and active metadata",
    async () => {
      const { rows } = await db.query(
        "SELECT role,active FROM public.profiles WHERE id=$1",
        [inactive],
      );
      assert.deepEqual(rows[0], { role: "employee", active: false });
    },
  );
  await db.query(
    "UPDATE public.profiles SET active=true,attendance_start='2000-01-01' WHERE id=ANY($1::uuid[])",
    [[emp, other, admin]],
  );
  await db.query("UPDATE public.profiles SET role='admin' WHERE id=$1", [
    admin,
  ]);
  await t.test("employee cannot promote self", () =>
    deny(emp, "UPDATE public.profiles SET role='admin' WHERE id=$1", [emp]),
  );
  await t.test("employee cannot insert self admin profile", () =>
    deny(
      emp,
      "INSERT INTO public.profiles(id,name,email,role) VALUES($1,'X','x@example.test','admin')",
      [emp],
    ),
  );
  await t.test("employee cannot activate account via RPC", () =>
    deny(emp, "SELECT public.clock_profile($1,$2,$3,true,$4)", [
      inactive,
      "Someone",
      "TI",
      "2026-01-01",
    ]),
  );
  await t.test("employee reads only own profile", async () =>
    assert.equal(
      (await run(emp, "SELECT * FROM public.profiles")).rows.length,
      1,
    ),
  );
  await t.test("inactive cannot punch", () =>
    deny(inactive, "SELECT public.clock_punch($1,$2,$3,$4,$5)", [
      randomUUID(),
      "entry_1",
      -12,
      -38,
      "test",
    ]),
  );
  let punch;
  const request = randomUUID();
  await t.test("employee punch uses database time", async () => {
    punch = (
      await run(emp, "SELECT * FROM public.clock_punch($1,$2,$3,$4,$5)", [
        request,
        "entry_1",
        -12,
        -38,
        "test",
      ])
    ).rows[0];
    assert.equal(punch.user_id, emp);
    assert.ok(
      Math.abs(new Date(punch.timestamp).getTime() - Date.now()) < 60000,
    );
  });
  await t.test("retry same request returns same punch", async () => {
    const result = await run(
      emp,
      "SELECT (public.clock_punch($1,$2,$3,$4,$5)).id",
      [request, "entry_1", -12, -38, "test"],
    );
    assert.equal(result.rows[0].id, punch.id);
  });
  await t.test("duplicate type rejected", () =>
    deny(emp, "SELECT public.clock_punch($1,$2,$3,$4,$5)", [
      randomUUID(),
      "entry_1",
      -12,
      -38,
      "test",
    ]),
  );
  await t.test("skipped type rejected", () =>
    deny(emp, "SELECT public.clock_punch($1,$2,$3,$4,$5)", [
      randomUUID(),
      "exit_2",
      -12,
      -38,
      "test",
    ]),
  );
  await t.test("missing coordinates rejected", () =>
    deny(other, "SELECT public.clock_punch($1,$2,$3,$4,$5)", [
      randomUUID(),
      "entry_1",
      null,
      null,
      "test",
    ]),
  );
  await t.test("direct timestamp insertion rejected", () =>
    deny(
      emp,
      "INSERT INTO public.time_entries(user_id,type,timestamp) VALUES($1,'exit_1',now())",
      [emp],
    ),
  );
  await t.test("direct change to own punch rejected", () =>
    deny(emp, "UPDATE public.time_entries SET timestamp=now() WHERE id=$1", [
      punch.id,
    ]),
  );
  await t.test("direct delete of own punch rejected", () =>
    deny(emp, "DELETE FROM public.time_entries WHERE id=$1", [punch.id]),
  );
  await t.test("other employee cannot read punch", async () =>
    assert.equal(
      (await run(other, "SELECT * FROM public.time_entries")).rows.length,
      0,
    ),
  );
  await t.test("admin can punch own journey", async () => {
    const r = (
      await run(admin, "SELECT * FROM public.clock_punch($1,$2,$3,$4,$5)", [
        randomUUID(),
        "entry_1",
        -12,
        -38,
        "test",
      ])
    ).rows[0];
    assert.equal(r.user_id, admin);
  });
  await t.test("employee cannot use adjustment RPC", () =>
    deny(emp, "SELECT public.clock_adjust($1,$2,$3,$4,$5,false)", [
      emp,
      punch.id,
      punch.timestamp,
      "entry_1",
      "Teste de ajuste",
    ]),
  );
  await t.test("admin adjustment requires reason", () =>
    deny(admin, "SELECT public.clock_adjust($1,$2,$3,$4,$5,false)", [
      emp,
      punch.id,
      punch.timestamp,
      "entry_1",
      "",
    ]),
  );
  const old = "2026-01-05T08:00:00-03:00";
  let adjusted;
  await t.test("admin can add missing historical punch", async () => {
    adjusted = (
      await run(
        admin,
        "SELECT * FROM public.clock_adjust($1,NULL,$2,$3,$4,false)",
        [emp, old, "entry_1", "Esquecimento justificado"],
      )
    ).rows[0];
    assert.equal(adjusted.user_id, emp);
  });
  await t.test("admin cannot duplicate historical slot", () =>
    deny(admin, "SELECT public.clock_adjust($1,NULL,$2,$3,$4,false)", [
      emp,
      old,
      "entry_1",
      "Esquecimento justificado",
    ]),
  );
  await t.test("chronological order validated", () =>
    deny(admin, "SELECT public.clock_adjust($1,NULL,$2,$3,$4,false)", [
      emp,
      "2026-01-05T07:00:00-03:00",
      "exit_1",
      "Horário incorreto teste",
    ]),
  );
  await t.test("admin editing records before and after", async () => {
    const changed = "2026-01-05T08:15:00-03:00";
    await run(admin,"SELECT public.clock_adjust($1,$2,$3,$4,$5,false)",[emp,adjusted.id,changed,"entry_1","Horário conferido com colaborador"]);
    const {rows} = await db.query("SELECT before_data,after_data,actor_id FROM public.audit_events WHERE entity_id=$1 AND action='adjust'",[adjusted.id]);
    assert.equal(rows.length,1);assert.equal(rows[0].actor_id,admin);
    assert.equal(new Date(rows[0].before_data.timestamp).getTime(),new Date(old).getTime());
    assert.equal(new Date(rows[0].after_data.timestamp).getTime(),new Date(changed).getTime());
  });
  await t.test("admin cannot bypass audit through direct update",()=>deny(admin,"UPDATE public.time_entries SET timestamp=now() WHERE id=$1",[adjusted.id]));
  await t.test("void preserves record and audit", async () => {
    await run(admin, "SELECT public.clock_adjust($1,$2,$3,$4,$5,true)", [
      emp,
      adjusted.id,
      old,
      "entry_1",
      "Cancelamento justificado",
    ]);
    const { rows } = await db.query(
      "SELECT voided_at FROM public.time_entries WHERE id=$1",
      [adjusted.id],
    );
    assert.ok(rows[0].voided_at);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM public.audit_events WHERE entity_id=$1 AND action='void'",
          [adjusted.id],
        )
      ).rows[0].n,
      1,
    );
  });
  await t.test("cancelled slot can be replaced", async () => {
    await run(admin, "SELECT public.clock_adjust($1,NULL,$2,$3,$4,false)", [
      emp,
      old,
      "entry_1",
      "Substituição justificada",
    ]);
  });
  const occ = randomUUID();
  await t.test("employee creates pending occurrence", async () => {
    const { rows } = await run(
      emp,
      "SELECT * FROM public.clock_occurrence($1,$2,$3,$4,NULL)",
      [occ, "2026-01-05", "forgotten_punch", "Solicito ajuste da entrada"],
    );
    assert.equal(rows[0].status, "pending");
  });
  await t.test("employee cannot approve own occurrence", () =>
    deny(emp, "UPDATE public.occurrences SET status='approved' WHERE id=$1", [
      occ,
    ]),
  );
  await t.test("employee cannot review via RPC", () =>
    deny(emp, "SELECT public.clock_review($1,'approved','Aprovado teste')", [
      occ,
    ]),
  );
  await t.test("admin reviews employee occurrence", async () => {
    await run(
      admin,
      "SELECT public.clock_review($1,'approved','Aprovado com justificativa')",
      [occ],
    );
    assert.equal(
      (
        await db.query(
          "SELECT reviewed_by FROM public.occurrences WHERE id=$1",
          [occ],
        )
      ).rows[0].reviewed_by,
      admin,
    );
  });
  await t.test("already reviewed occurrence cannot be overwritten", () =>
    deny(
      admin,
      "SELECT public.clock_review($1,'rejected','Novo parecer teste')",
      [occ],
    ),
  );
  await t.test("admin cannot approve own occurrence", async () => {
    const id = randomUUID();
    await run(
      admin,
      "SELECT public.clock_occurrence($1,'2026-01-05','other','Minha solicitação',NULL)",
      [id],
    );
    await deny(
      admin,
      "SELECT public.clock_review($1,'approved','Meu parecer teste')",
      [id],
    );
  });
  await t.test("audit cannot be changed or removed by admin", async () => {
    await deny(admin, "DELETE FROM public.audit_events");
    await deny(admin, "UPDATE public.audit_events SET reason='alterado'");
  });
  await t.test("employee cannot see others audit", async () =>
    assert.equal(
      (await run(other, "SELECT * FROM public.audit_events")).rows.length,
      0,
    ),
  );
  await t.test("admin cannot deactivate own account", () =>
    deny(admin, "SELECT public.clock_profile($1,$2,$3,false,$4)", [
      admin,
      "Admin",
      "TI",
      "2026-01-01",
    ]),
  );
  await t.test("admin activates new employee", async () => {
    await run(admin, "SELECT public.clock_profile($1,$2,$3,true,$4)", [
      inactive,
      "Novo colaborador",
      "TI",
      "2026-01-01",
    ]);
    assert.equal(
      (
        await db.query("SELECT active FROM public.profiles WHERE id=$1", [
          inactive,
        ])
      ).rows[0].active,
      true,
    );
  });
  await t.test("private storage isolates employee folders", async () => {
    await run(
      emp,
      "INSERT INTO storage.objects(bucket_id,name) VALUES('clock-documents',$1)",
      [emp + "/doc.pdf"],
    );
    assert.equal(
      (
        await run(
          other,
          "SELECT * FROM storage.objects WHERE bucket_id='clock-documents'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await run(
          admin,
          "SELECT * FROM storage.objects WHERE bucket_id='clock-documents'",
        )
      ).rows.length,
      1,
    );
    await deny(
      emp,
      "INSERT INTO storage.objects(bucket_id,name) VALUES('clock-documents',$1)",
      [other + "/doc.pdf"],
    );
  });
  await t.test("another persons attachment cannot be linked",()=>deny(other,"SELECT public.clock_occurrence($1,'2026-01-05','other','Solicitação com anexo',$2)",[randomUUID(),emp+'/doc.pdf']));
  await t.test("null occurrence description rejected",()=>deny(emp,"SELECT public.clock_occurrence($1,'2026-01-05','other',NULL,NULL)",[randomUUID()]));
  await t.test("deactivated session cannot punch or read points",async()=>{
    await run(admin,"SELECT public.clock_profile($1,'User 0','TI',false,'2000-01-01')",[emp]);
    await deny(emp,"SELECT public.clock_punch($1,'exit_1',-12,-38,'test')",[randomUUID()]);
    assert.equal((await run(emp,'SELECT * FROM public.time_entries')).rows.length,0);
    await run(admin,"SELECT public.clock_profile($1,'User 0','TI',true,'2000-01-01')",[emp]);
  });
  await t.test(
    "broad storage policies cannot bypass private bucket",
    async () => {
      await db.exec(
        "CREATE POLICY overly_broad ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true)",
      );
      assert.equal(
        (
          await run(
            other,
            "SELECT * FROM storage.objects WHERE bucket_id='clock-documents'",
          )
        ).rows.length,
        0,
      );
      const r = await run(
        emp,
        "DELETE FROM storage.objects WHERE bucket_id='clock-documents' RETURNING id",
      );
      assert.equal(r.rows.length, 0);
    },
  );
  await t.test("anonymous cannot read application tables", async () => {
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        return tx.query("SELECT * FROM public.profiles");
      }),
    );
  });
  await t.test(
    "migration can be applied again without losing data",
    async () => {
      await db.exec(
        readFileSync(
          new URL("../supabase/migrations/" + migrations[2], import.meta.url),
          "utf8",
        ),
      );
      assert.ok(
        (await db.query("SELECT * FROM public.time_entries")).rows.length >= 3,
      );
    },
  );
});
