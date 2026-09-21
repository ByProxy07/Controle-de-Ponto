-- Somente leitura. Executar antes da migração de segurança em banco existente.
-- 1. Duplicatas impedem a criação do índice único. Não apague dados reais sem revisão.
SELECT user_id,(timestamp AT TIME ZONE 'America/Sao_Paulo')::date AS dia,type,count(*)
FROM public.time_entries GROUP BY 1,2,3 HAVING count(*)>1;
-- 2. Contas administrativas antigas: confira cada identidade antes de ativar.
SELECT id,name,email,role FROM public.profiles WHERE role='admin';
-- 3. Políticas e funções adicionais criadas fora do ZIP precisam de revisão.
SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='public';
SELECT n.nspname,p.proname,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef;
SELECT tgname FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal;
