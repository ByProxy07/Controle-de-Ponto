import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
test("solicitações de alteração: autorização, auditoria e aplicação atômica", async (t) => {
 const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');
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
    "20260923100000_driver_portal.sql",
    "20261007150000_punch_change_requests.sql",
  ];
  for (const f of migrations)
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );

 const [emp,other,admin,admin2,inactive,driver] = Array.from({length:6},()=>randomUUID());
 for (const [i,id] of [emp,other,admin,admin2,inactive,driver].entries()) {
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,`p${i}@example.test`]);
 }
 await db.query("UPDATE profiles SET active=true,attendance_start='2000-01-01' WHERE id<>$1",[inactive]);
 await db.query("UPDATE profiles SET role='admin' WHERE id=ANY($1::uuid[])",[[admin,admin2]]);
 await db.query("UPDATE profiles SET account_kind='driver' WHERE id=$1",[driver]);
 const run=(id,sql,args=[])=>db.transaction(async tx=>{
   await tx.exec('SET LOCAL ROLE authenticated');
   await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]);
   return tx.query(sql,args);
 });
 const reject=(id,sql,args=[])=>assert.rejects(()=>run(id,sql,args));
 const add=async (user,day='2026-01-05',type='entry_1',time='08:00')=>(await db.query(
   "INSERT INTO time_entries(user_id,type,timestamp) VALUES($1,$2,$3) RETURNING *",[user,type,`${day}T${time}:00-03:00`])).rows[0];
 const request=(user,e,time='08:15',id=randomUUID())=>run(user,
   "SELECT * FROM clock_request_change($1,$2,$3,'Solicito corrigir meu horário')",[id,e.id,`2026-01-05T${time}:00-03:00`]);
 const review=(user,id,status='approved')=>run(user,"SELECT * FROM clock_review_change($1,$2,'Conferido pelo responsável')",[id,status]);
 const entry=await add(emp); const own=await add(admin); const dentry=await add(driver);
 let req;
 await t.test('solicitar mantém a marcação original e permite reenvio idempotente',async()=>{
   const id=randomUUID(); req=(await request(emp,entry,'08:15',id)).rows[0];
   assert.equal(req.status,'pending');
   assert.equal(new Date((await db.query('SELECT timestamp FROM time_entries WHERE id=$1',[entry.id])).rows[0].timestamp).getTime(),new Date(entry.timestamp).getTime());
   assert.equal((await request(emp,entry,'08:15',id)).rows[0].id,id);
   await assert.rejects(()=>request(emp,entry,'08:16',id));
   await assert.rejects(()=>request(emp,entry,'08:20'));
 });
 await t.test('titularidade, conta ativa, dia, futuro, sem mudança e justificativa',async()=>{
   await assert.rejects(()=>request(other,entry));
   await assert.rejects(()=>request(inactive,entry));
   for (const timestamp of ['2099-01-05T08:00-03:00','2026-01-06T08:00-03:00','2026-01-05T08:00-03:00','infinity','-infinity'])
     await reject(emp,"SELECT clock_request_change($1,$2,$3,'Pedido de teste')",[randomUUID(),entry.id,timestamp]);
   await reject(emp,"SELECT clock_request_change($1,$2,'2026-01-05T08:15-03:00','  ')",[randomUUID(),entry.id]);
 });
 await t.test('RLS e bloqueio de escrita direta para funcionários e administradores',async()=>{
   assert.equal((await run(other,'SELECT * FROM punch_change_requests')).rows.length,0);
   assert.equal((await run(emp,'SELECT * FROM punch_change_requests')).rows.length,1);
   assert.equal((await run(admin,'SELECT * FROM punch_change_requests')).rows.length,1);
   assert.equal((await run(inactive,'SELECT * FROM punch_change_requests')).rows.length,0);
   for (const id of [emp,admin]) {
     await reject(id,"UPDATE punch_change_requests SET status='approved'");
     await reject(id,'DELETE FROM punch_change_requests');
     await reject(id,"INSERT INTO punch_change_requests SELECT * FROM punch_change_requests");
   }
   await assert.rejects(()=>review(emp,req.id));
   await assert.rejects(()=>db.transaction(async tx=>{await tx.exec('SET LOCAL ROLE anon');await tx.exec('SELECT * FROM punch_change_requests');}));
 });
 await t.test('aprovação aplica horário e audita antes/depois; repetição não duplica',async()=>{
   await review(admin,req.id); await review(admin,req.id);
   const e=(await db.query('SELECT * FROM time_entries WHERE id=$1',[entry.id])).rows[0];
   assert.equal(new Date(e.timestamp).toISOString(),'2026-01-05T11:15:00.000Z');assert.equal(e.edited_by,admin);
   const a=(await db.query("SELECT * FROM audit_events WHERE entity_id=$1 AND action='adjust'",[entry.id])).rows;
   assert.equal(a.length,1);assert.equal(new Date(a[0].before_data.timestamp).getTime(),new Date(entry.timestamp).getTime());
   assert.equal((await db.query("SELECT * FROM audit_events WHERE entity_id=$1 AND action='review_change'",[req.id])).rows.length,1);
   await assert.rejects(()=>review(admin2,req.id));
   await assert.rejects(()=>review(admin,req.id,'rejected'));
 });
 await t.test('recusa mantém marcação e possibilita novo pedido',async()=>{
   const fresh=(await db.query('SELECT * FROM time_entries WHERE id=$1',[entry.id])).rows[0];
   const r=(await request(emp,fresh,'08:20')).rows[0];await review(admin,r.id,'rejected');
   assert.equal(new Date((await db.query('SELECT timestamp FROM time_entries WHERE id=$1',[entry.id])).rows[0].timestamp).getTime(),new Date(fresh.timestamp).getTime());
   const again=(await request(emp,fresh,'08:25')).rows[0];assert.equal(again.status,'pending');
   await review(admin,again.id,'rejected');
 });
 await t.test('administrador não aprova nem ajusta seu próprio ponto, outro aprova',async()=>{
   const r=(await request(admin,own)).rows[0];
   await assert.rejects(()=>review(admin,r.id));
   for (const entryId of [own.id,null])
     await reject(admin,"SELECT clock_adjust($1,$2,'2026-01-05T08:20-03:00','entry_1','Meu ajuste próprio',false)",[admin,entryId]);
   await reject(admin,"SELECT clock_adjust($1,$2,NULL,NULL,'Meu cancelamento',true)",[admin,own.id]);
   await review(admin2,r.id);
 });
 await t.test('motorista também pode solicitar correção',async()=>{
   const r=(await request(driver,dentry)).rows[0];await review(admin,r.id);
   assert.equal((await run(driver,'SELECT * FROM punch_change_requests')).rows.length,1);
 });
 await t.test('pedido desatualizado não sobrescreve ajuste feito depois',async()=>{
   const fresh=(await db.query('SELECT * FROM time_entries WHERE id=$1',[entry.id])).rows[0];
   const r=(await request(emp,fresh,'08:25')).rows[0];
   await run(admin,"SELECT clock_adjust($1,$2,'2026-01-05T08:30-03:00','entry_1','Outro ajuste posterior',false)",[emp,entry.id]);
   await assert.rejects(()=>review(admin,r.id));
   assert.equal((await db.query('SELECT status FROM punch_change_requests WHERE id=$1',[r.id])).rows[0].status,'pending');
   await review(admin,r.id,'rejected');
 });
 await t.test('sequência validada na solicitação e novamente na aprovação',async()=>{
   const fresh=(await db.query('SELECT * FROM time_entries WHERE id=$1',[entry.id])).rows[0];
   const r=(await request(emp,fresh,'09:00')).rows[0];
   await add(emp,'2026-01-05','exit_1','08:45');
   await assert.rejects(()=>review(admin,r.id));
   await review(admin,r.id,'rejected');
   await assert.rejects(()=>request(emp,fresh,'09:00'));
 });
 await t.test('cancelamento e inativação bloqueiam aprovação sem alteração parcial',async()=>{
   const r=(await request(driver,(await db.query('SELECT * FROM time_entries WHERE id=$1',[dentry.id])).rows[0],'08:20')).rows[0];
   await db.query('UPDATE profiles SET active=false WHERE id=$1',[driver]);
   await assert.rejects(()=>review(admin,r.id));
   await db.query('UPDATE profiles SET active=true WHERE id=$1',[driver]);
   await run(admin,"SELECT clock_adjust($1,$2,NULL,NULL,'Cancelamento posterior',true)",[driver,dentry.id]);
   await assert.rejects(()=>review(admin,r.id));
   await review(admin,r.id,'rejected');
 });
 await t.test('reaplicar migração preserva dados e permissões',async()=>{
   const count=(await db.query('SELECT count(*) AS n FROM punch_change_requests')).rows[0].n;
   await db.exec(readFileSync(new URL('../supabase/migrations/20261007150000_punch_change_requests.sql',import.meta.url),'utf8'));
   assert.equal((await db.query('SELECT count(*) AS n FROM punch_change_requests')).rows[0].n,count);
   await reject(emp,"UPDATE punch_change_requests SET status='approved'");
 });
});
