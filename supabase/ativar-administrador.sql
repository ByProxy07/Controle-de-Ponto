-- Depois de aplicar a migração e criar/confirmar sua conta pelo aplicativo.
-- Copie o UUID correto de Authentication > Users; não use e-mail não verificado.
-- Executar exclusivamente no SQL Editor, como responsável pelo banco.
DO $$
DECLARE target uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
 IF target='00000000-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'Substitua o UUID pelo ID da sua conta antes de executar.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Conta inexistente ou e-mail ainda não confirmado.'; END IF;
 INSERT INTO public.profiles(id,name,email,role,active,attendance_start)
 SELECT id,coalesce(nullif(raw_user_meta_data->>'name',''),'Administrador'),email,'employee',false,(now() AT TIME ZONE 'America/Sao_Paulo')::date FROM auth.users WHERE id=target
 ON CONFLICT(id) DO NOTHING;
 UPDATE public.profiles SET role='admin',active=true WHERE id=target;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,after_data)
 SELECT NULL,'profiles',id,id,'bootstrap_admin','Administrador habilitado pelo responsável no SQL Editor',to_jsonb(p) FROM public.profiles p WHERE id=target;
END $$;
