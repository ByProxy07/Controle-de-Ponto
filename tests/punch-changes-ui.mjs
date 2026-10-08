// Interface com API simulada. Nenhuma requisição alcança o Supabase real.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const port = 4175;
const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{
  stdio:'ignore',env:{...process.env,VITE_SUPABASE_URL:'https://clock-test.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_publishable_test_only'}
});
let browser;
const users = [
 {id:'10000000-0000-0000-0000-000000000001',name:'Coordenador Teste',role:'admin',account_kind:'team'},
 {id:'10000000-0000-0000-0000-000000000002',name:'Colaborador Teste',role:'employee',account_kind:'team'},
 {id:'10000000-0000-0000-0000-000000000003',name:'Motorista Teste',role:'employee',account_kind:'driver'},
].map(p=>({...p,email:`${p.id}@example.test`,active:true,attendance_start:'2000-01-01',job_title:'Teste',work_schedule:{daily_target_minutes:528},created_at:'2026-01-01T00:00:00Z'}));
const entries=users.map((u,i)=>({id:`20000000-0000-0000-0000-00000000000${i+1}`,user_id:u.id,type:'entry_1',timestamp:'2026-01-05T11:00:00Z',created_at:'2026-01-05T11:00:00Z'}));
const items=[]; const calls=[]; const errors=[]; let failSend=true;
async function pageFor(user,mobile=false){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
 await ctx.addInitScript(({user})=>localStorage.setItem('sb-clock-test-auth-token',JSON.stringify({access_token:'mock-token',refresh_token:'mock-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user.id,email:user.email,aud:'authenticated',role:'authenticated'}})),{user});
 await ctx.addInitScript(() => Object.defineProperty(globalThis.crypto, 'randomUUID', {value: undefined, configurable: true}));
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();
  const done=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(u.pathname==='/auth/v1/user')return done({id:user.id,email:user.email,aud:'authenticated',role:'authenticated'});
  if(u.pathname.startsWith('/rest/v1/rpc/')){
   const name=u.pathname.split('/').at(-1),args=route.request().postDataJSON();calls.push({name,args,user:user.id});
   if(name==='clock_request_change'){
    if(failSend){failSend=false;return done({message:'Falha simulada: tente novamente'},503);}
    const e=entries.find(e=>e.id===args.p_entry);
    const item={id:args.p_id,user_id:user.id,entry_id:e.id,original_timestamp:e.timestamp,original_type:e.type,requested_timestamp:args.p_timestamp,reason:args.p_reason,status:'pending',created_at:new Date().toISOString()};
    items.push(item);return done(item);
   }
   if(name==='clock_review_change'){
    const r=items.find(r=>r.id===args.p_id);r.status=args.p_status;r.review_notes=args.p_notes;r.reviewed_by=user.id;r.reviewed_at=new Date().toISOString();
    if(r.status==='approved'){const e=entries.find(e=>e.id===r.entry_id);e.timestamp=r.requested_timestamp;e.edited_at=r.reviewed_at;}
    return done(r);
   }
   return done({message:'RPC inesperada'},400);
  }
  if(u.pathname.endsWith('/profiles')){const id=u.searchParams.get('id')?.replace('eq.','');return done(id?users.find(p=>p.id===id):users);}
  if(u.pathname.endsWith('/time_entries')){let rows=entries;const id=u.searchParams.get('user_id')?.replace('eq.','');if(id)rows=rows.filter(e=>e.user_id===id);return done(rows);}
  if(u.pathname.endsWith('/punch_change_requests'))return done(user.role==='admin'?items:items.filter(r=>r.user_id===user.id));
  if(u.pathname.endsWith('/occurrences')||u.pathname.endsWith('/audit_events'))return done([]);
  return done({message:'Requisição externa bloqueada'},400);
 });
 await page.goto(`http://127.0.0.1:${port}${mobile?'/motoristas':''}`);
 return page;
}
try{
 for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.env.CLOCK_TEST_BROWSER?{executablePath:process.env.CLOCK_TEST_BROWSER}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const emp=await pageFor(users[1]);
 await emp.getByRole('button',{name:'Alterar horário',exact:true}).click();
 await emp.getByLabel('Data da marcação').fill('2026-01-05');
 await emp.getByLabel('Marcação que deseja corrigir').selectOption(entries[1].id);
 await emp.getByLabel('Novo horário solicitado').fill('08:15');
 await emp.getByLabel('Justificativa obrigatória').fill('Registro realizado depois da chegada. Solicito conferência.');
 await emp.getByRole('button',{name:'Enviar pedido de alteração'}).click();
 await emp.getByText('Falha simulada: tente novamente',{exact:true}).waitFor();
 await emp.getByRole('button',{name:'Enviar pedido de alteração'}).click();
 await emp.getByText('Pedido enviado. O horário registrado só mudará após a aprovação.').waitFor();
 assert.equal(calls[0].args.p_id,calls[1].args.p_id);assert.equal(entries[1].timestamp,'2026-01-05T11:00:00Z');
 await emp.screenshot({path:'../employee-change.png',fullPage:true});
 const admin=await pageFor(users[0]);
 await admin.getByRole('button',{name:'Alterações de horário',exact:true}).click();
 await admin.getByLabel('Mês',{exact:true}).fill('2026-01');
 await admin.getByRole('button',{name:'Aprovar alteração',exact:true}).click();
 await admin.getByLabel('Parecer obrigatório').fill('Horário confirmado com a equipe.');
 await admin.getByRole('button',{name:'Confirmar decisão'}).click();
 await admin.getByText('Pedido aprovado e horário atualizado com histórico.').waitFor();
 await admin.getByLabel('Situação do pedido').selectOption('all');
 await admin.locator('article p').filter({hasText:'· Aprovada'}).waitFor();
 await admin.screenshot({path:'../admin-change.png',fullPage:true});
 await emp.getByRole('button',{name:'Atualizar pedidos'}).click();
 await emp.getByText('Parecer: Horário confirmado com a equipe.').waitFor();
 await emp.getByRole('button',{name:'Espelho mensal',exact:true}).click();
 await emp.getByLabel('Mês',{exact:true}).fill('2026-01');
 await emp.getByRole('cell',{name:'08:15',exact:true}).waitFor();
 // Um administrador usa Meu ponto e não recebe botão para aprovar o próprio pedido.
 items.push({id:'30000000-0000-0000-0000-000000000001',user_id:users[0].id,entry_id:entries[0].id,original_timestamp:entries[0].timestamp,original_type:'entry_1',requested_timestamp:'2026-01-05T11:15:00Z',reason:'Pedido próprio do administrador',status:'pending',created_at:new Date().toISOString()});
 await admin.getByRole('button',{name:'Atualizar pedidos'}).click();
 await admin.getByText('Outro administrador deve analisar sua solicitação.',{exact:true}).waitFor();
 const ownArticle=admin.locator('article').filter({hasText:'Pedido próprio do administrador'});
 assert.equal(await ownArticle.getByRole('button',{name:'Aprovar alteração'}).count(),0);
 await admin.getByRole('button',{name:'Marcações',exact:true}).click();
 const ownRow=admin.getByRole('row').filter({hasText:'Coordenador Teste'});
 assert.equal(await ownRow.getByRole('button',{name:'Revisar',exact:true}).count(),0);
 const driver=await pageFor(users[2],true);
 await driver.locator('summary').filter({hasText:'Solicitar alteração de horário'}).click();
 await driver.getByLabel('Data da marcação').fill('2026-01-05');
 await driver.getByLabel('Marcação que deseja corrigir').selectOption(entries[2].id);
 await driver.getByLabel('Novo horário solicitado').fill('08:10');
 await driver.getByLabel('Justificativa obrigatória').fill('Conferir horário do motorista.');
 await driver.getByRole('button',{name:'Enviar pedido de alteração'}).click();
 await driver.getByText('Pedido enviado. O horário registrado só mudará após a aprovação.').waitFor();
 await driver.screenshot({path:'../driver-change.png',fullPage:true});
 assert.equal(await driver.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 await admin.getByRole('button',{name:'Alterações de horário',exact:true}).click();
 const darticle=admin.locator('article').filter({hasText:'Conferir horário do motorista.'});
 await darticle.getByRole('button',{name:'Recusar alteração'}).click();
 await admin.getByLabel('Parecer obrigatório').fill('Horário original conferido e mantido.');
 await admin.getByRole('button',{name:'Confirmar decisão'}).click();
 await admin.getByText('Pedido recusado. A marcação foi mantida.').waitFor();
 assert.equal(entries[2].timestamp,'2026-01-05T11:00:00Z');
 assert.deepEqual(errors,[]);
 console.log('PASS: envio/reenvio, aprovação, espelho atualizado, recusa, isolamento do próprio admin e motorista em celular.');
}finally{await browser?.close();server.kill();}
