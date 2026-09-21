-- Executar APÓS as duas migrações originais. Transação: falhas não deixam aplicação parcial.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS attendance_start date;
UPDATE public.profiles SET attendance_start = (created_at AT TIME ZONE 'America/Sao_Paulo')::date WHERE attendance_start IS NULL;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edit_reason text;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edited_by uuid;
ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS edited_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_request_key ON public.time_entries(user_id, request_id) WHERE request_id IS NOT NULL;
-- Não apagar nem resolver duplicatas antigas silenciosamente: verificação no guia.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_day_type_key ON public.time_entries
 (user_id, ((timestamp AT TIME ZONE 'America/Sao_Paulo')::date), type) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid,
 entity text NOT NULL, entity_id uuid NOT NULL, subject_id uuid,
 action text NOT NULL, reason text NOT NULL, before_data jsonb, after_data jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS audit_events_date_idx ON public.audit_events(created_at DESC, id);

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' AND active);
$$;
CREATE OR REPLACE FUNCTION public.is_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active);
$$;
REVOKE ALL ON FUNCTION public.is_admin(), public.is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_active() TO authenticated, anon;

-- Substituir TODAS as políticas dessas tabelas: permissões antigas são permissivas por OR.
DO $$ DECLARE p record; BEGIN
 FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('profiles','time_entries','occurrences','audit_events') LOOP
 EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname,p.schemaname,p.tablename);
 END LOOP;
END $$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.time_entries, public.occurrences, public.audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles, public.time_entries, public.occurrences, public.audit_events TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_admin());
CREATE POLICY entries_read ON public.time_entries FOR SELECT TO authenticated USING (public.is_active() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY occurrences_read ON public.occurrences FOR SELECT TO authenticated USING (public.is_active() AND (user_id = auth.uid() OR public.is_admin()));
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING (public.is_active() AND (subject_id = auth.uid() OR public.is_admin()));

-- Metadados do cliente NUNCA determinam cargo/permissão. Novos usuários aguardam ativação.
CREATE OR REPLACE FUNCTION public.clock_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
 INSERT INTO public.profiles(id,name,email,role,active,attendance_start)
 VALUES(NEW.id, left(coalesce(nullif(NEW.raw_user_meta_data->>'name',''), 'Colaborador'),120),
 NEW.email, 'employee',false,(now() AT TIME ZONE 'America/Sao_Paulo')::date)
 ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clock_new_user ON auth.users;
CREATE TRIGGER clock_new_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.clock_new_user();
REVOKE ALL ON FUNCTION public.clock_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.clock_punch(p_request_id uuid, p_type text, p_lat double precision, p_lng double precision, p_device text)
RETURNS public.time_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.time_entries; expected text; today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; BEGIN
 IF NOT public.is_active() THEN RAISE EXCEPTION 'Conta não ativada.'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identificador obrigatório.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
 SELECT * INTO r FROM public.time_entries WHERE user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
 IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Este registro foi cancelado. Atualize a tela e solicite revisão.'; END IF;
 RETURN r; END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lng BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'Localização inválida.'; END IF;
 SELECT t INTO expected FROM unnest(ARRAY['entry_1','exit_1','entry_2','exit_2']) WITH ORDINALITY x(t,n)
 WHERE NOT EXISTS(SELECT 1 FROM public.time_entries e WHERE e.user_id=auth.uid() AND e.voided_at IS NULL AND (e.timestamp AT TIME ZONE 'America/Sao_Paulo')::date=today AND e.type=x.t)
 ORDER BY n LIMIT 1;
 IF expected IS NULL OR p_type IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Sequência mudou. Atualize os registros antes de bater o ponto.'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries e WHERE e.user_id=auth.uid() AND e.voided_at IS NULL
 AND (e.timestamp AT TIME ZONE 'America/Sao_Paulo')::date=today
 AND array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],e.type) > array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],expected))
 THEN RAISE EXCEPTION 'Há uma marcação anterior faltando. Solicite ajuste ao administrador.'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND attendance_start>today) THEN RAISE EXCEPTION 'O controle de ponto ainda não iniciou para esta conta.'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries WHERE user_id=auth.uid() AND voided_at IS NULL AND timestamp >= now()) THEN RAISE EXCEPTION 'Há registro futuro ou simultâneo. Solicite revisão.'; END IF;
 INSERT INTO public.time_entries(user_id,type,timestamp,latitude,longitude,device_info,request_id)
 VALUES(auth.uid(),expected,now(),p_lat,p_lng,left(p_device,300),p_request_id) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,after_data)
 VALUES(auth.uid(),'time_entries',r.id,auth.uid(),'punch','Registro pelo titular',to_jsonb(r));
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.clock_adjust(p_user uuid, p_entry uuid, p_timestamp timestamptz, p_type text, p_reason text, p_void boolean DEFAULT false)
RETURNS public.time_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_r public.time_entries; r public.time_entries; target_day date; type_order int; BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador.'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Informe um motivo de 5 a 1000 caracteres.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 IF p_entry IS NOT NULL THEN
 SELECT * INTO old_r FROM public.time_entries WHERE id=p_entry AND user_id=p_user FOR UPDATE;
 IF NOT FOUND OR old_r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Registro inexistente ou já cancelado.'; END IF;
 END IF;
 IF p_void THEN
 IF p_entry IS NULL THEN RAISE EXCEPTION 'Selecione o registro.'; END IF;
 UPDATE public.time_entries SET voided_at=now(),edited_at=now(),edited_by=auth.uid(),edit_reason=trim(p_reason) WHERE id=p_entry RETURNING * INTO r;
 ELSE
 type_order := array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],p_type);
 IF type_order IS NULL OR p_timestamp IS NULL OR p_timestamp > now() THEN RAISE EXCEPTION 'Tipo ou horário inválido; não use datas futuras.'; END IF;
 target_day := (p_timestamp AT TIME ZONE 'America/Sao_Paulo')::date;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user AND active AND attendance_start <= target_day) THEN RAISE EXCEPTION 'Colaborador inativo ou data anterior ao início do controle.'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries e WHERE e.user_id=p_user AND e.voided_at IS NULL AND e.id IS DISTINCT FROM p_entry
 AND (e.timestamp AT TIME ZONE 'America/Sao_Paulo')::date=target_day
 AND ((array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],e.type) < type_order AND e.timestamp >= p_timestamp)
 OR (array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],e.type) > type_order AND e.timestamp <= p_timestamp))) THEN RAISE EXCEPTION 'Horário fora da ordem das marcações.'; END IF;
 IF p_entry IS NULL THEN
 INSERT INTO public.time_entries(user_id,timestamp,type,edit_reason,edited_by,edited_at) VALUES(p_user,p_timestamp,p_type,trim(p_reason),auth.uid(),now()) RETURNING * INTO r;
 ELSE
 UPDATE public.time_entries SET timestamp=p_timestamp,type=p_type,edit_reason=trim(p_reason),edited_by=auth.uid(),edited_at=now() WHERE id=p_entry RETURNING * INTO r;
 END IF;
 END IF;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,before_data,after_data)
 VALUES(auth.uid(),'time_entries',r.id,p_user,CASE WHEN p_void THEN 'void' WHEN p_entry IS NULL THEN 'add' ELSE 'adjust' END,trim(p_reason),CASE WHEN p_entry IS NULL THEN NULL ELSE to_jsonb(old_r) END,to_jsonb(r));
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.clock_occurrence(p_id uuid,p_date date,p_type text,p_description text,p_attachment text DEFAULT NULL)
RETURNS public.occurrences LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.occurrences; BEGIN
 IF NOT public.is_active() THEN RAISE EXCEPTION 'Conta não ativada.'; END IF;
 IF p_id IS NULL OR p_date IS NULL OR p_description IS NULL OR p_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date OR length(trim(p_description)) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Confira data e descrição (5 a 2000 caracteres).'; END IF;
 IF p_attachment IS NOT NULL AND (split_part(p_attachment,'/',1) <> auth.uid()::text OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='clock-documents' AND name=p_attachment)) THEN RAISE EXCEPTION 'Anexo inválido.'; END IF;
 INSERT INTO public.occurrences(id,user_id,date,type,description,attachment_url,status)
 VALUES(p_id,auth.uid(),p_date,p_type,trim(p_description),p_attachment,'pending') ON CONFLICT(id) DO NOTHING;
 SELECT * INTO r FROM public.occurrences WHERE id=p_id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Identificador já utilizado.'; END IF;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.clock_review(p_id uuid,p_status text,p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_r public.occurrences; r public.occurrences; BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador.'; END IF;
 SELECT * INTO old_r FROM public.occurrences WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR old_r.status <> 'pending' THEN RAISE EXCEPTION 'Solicitação inexistente ou já analisada.'; END IF;
 IF old_r.user_id=auth.uid() THEN RAISE EXCEPTION 'Outro administrador deve analisar sua solicitação.'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('approved','rejected') OR p_notes IS NULL OR length(trim(p_notes)) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION 'Informe decisão e justificativa (5 a 1000 caracteres).'; END IF;
 UPDATE public.occurrences SET status=p_status,admin_notes=trim(p_notes),reviewed_by=auth.uid(),reviewed_at=now() WHERE id=p_id RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,before_data,after_data)
 VALUES(auth.uid(),'occurrences',r.id,r.user_id,'review',trim(p_notes),to_jsonb(old_r),to_jsonb(r));
END $$;

CREATE OR REPLACE FUNCTION public.clock_profile(p_id uuid,p_name text,p_job text,p_active boolean,p_start date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_r public.profiles; r public.profiles; BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador.'; END IF;
 IF p_id=auth.uid() AND NOT p_active THEN RAISE EXCEPTION 'Você não pode desativar a própria conta.'; END IF;
 IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 2 AND 120 OR p_active IS NULL OR p_start IS NULL THEN RAISE EXCEPTION 'Confira nome, situação e início do controle.'; END IF;
 SELECT * INTO old_r FROM public.profiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado.'; END IF;
 UPDATE public.profiles SET name=trim(p_name),job_title=left(p_job,120),active=p_active,attendance_start=p_start WHERE id=p_id RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,before_data,after_data)
 VALUES(auth.uid(),'profiles',p_id,p_id,'profile','Atualização cadastral pelo administrador',to_jsonb(old_r),to_jsonb(r));
END $$;

REVOKE ALL ON FUNCTION public.clock_punch(uuid,text,double precision,double precision,text),public.clock_adjust(uuid,uuid,timestamptz,text,text,boolean),public.clock_occurrence(uuid,date,text,text,text),public.clock_review(uuid,text,text),public.clock_profile(uuid,text,text,boolean,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clock_punch(uuid,text,double precision,double precision,text),public.clock_adjust(uuid,uuid,timestamptz,text,text,boolean),public.clock_occurrence(uuid,date,text,text,text),public.clock_review(uuid,text,text),public.clock_profile(uuid,text,text,boolean,date) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('clock-documents','clock-documents',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];
DROP POLICY IF EXISTS clock_documents_insert ON storage.objects;
DROP POLICY IF EXISTS clock_documents_read ON storage.objects;
DROP POLICY IF EXISTS clock_documents_guard ON storage.objects;
-- Restritiva impede políticas antigas genéricas de liberar este bucket.
CREATE POLICY clock_documents_guard ON storage.objects AS RESTRICTIVE FOR ALL TO public
 USING(bucket_id <> 'clock-documents' OR (public.is_active() AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin())))
 WITH CHECK(bucket_id <> 'clock-documents' OR (public.is_active() AND (storage.foldername(name))[1]=auth.uid()::text));
CREATE POLICY clock_documents_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='clock-documents' AND public.is_active() AND (storage.foldername(name))[1]=auth.uid()::text);
CREATE POLICY clock_documents_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='clock-documents' AND public.is_active() AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin()));
-- Nem políticas genéricas podem autorizar substituir/apagar atestados neste bucket.
DROP POLICY IF EXISTS clock_documents_no_update ON storage.objects;
DROP POLICY IF EXISTS clock_documents_no_delete ON storage.objects;
CREATE POLICY clock_documents_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO public USING(bucket_id <> 'clock-documents') WITH CHECK(bucket_id <> 'clock-documents');
CREATE POLICY clock_documents_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO public USING(bucket_id <> 'clock-documents');
NOTIFY pgrst, 'reload schema';
COMMIT;
