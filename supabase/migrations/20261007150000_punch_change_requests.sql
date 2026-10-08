-- Aplicar no Supabase atual, após as migrações de segurança e motoristas.
BEGIN;
CREATE TABLE IF NOT EXISTS public.punch_change_requests (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.profiles(id),
 entry_id uuid NOT NULL REFERENCES public.time_entries(id),
 original_timestamp timestamptz NOT NULL,
 original_type text NOT NULL,
 original_edited_at timestamptz,
 requested_timestamp timestamptz NOT NULL,
 reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 review_notes text,
 reviewed_by uuid REFERENCES public.profiles(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS punch_change_pending_entry ON public.punch_change_requests(entry_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS punch_change_user_idx ON public.punch_change_requests(user_id,created_at DESC);
ALTER TABLE public.punch_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.punch_change_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.punch_change_requests TO authenticated;
DROP POLICY IF EXISTS punch_change_read ON public.punch_change_requests;
CREATE POLICY punch_change_read ON public.punch_change_requests FOR SELECT TO authenticated
 USING (public.is_active() AND (user_id=auth.uid() OR public.is_admin()));

CREATE OR REPLACE FUNCTION public.clock_request_change(p_id uuid,p_entry uuid,p_timestamp timestamptz,p_reason text)
RETURNS public.punch_change_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.time_entries; r public.punch_change_requests; target_day date; BEGIN
 IF NOT public.is_active() THEN RAISE EXCEPTION 'Conta não ativada.'; END IF;
 IF p_id IS NULL OR p_entry IS NULL OR p_timestamp IS NULL OR NOT isfinite(p_timestamp)
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
 RAISE EXCEPTION 'Informe a marcação, o horário e uma justificativa de 5 a 1000 caracteres.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM public.punch_change_requests WHERE id=p_id;
 IF FOUND THEN
 IF r.user_id IS DISTINCT FROM auth.uid() OR r.entry_id IS DISTINCT FROM p_entry
 OR r.requested_timestamp IS DISTINCT FROM p_timestamp OR r.reason IS DISTINCT FROM trim(p_reason)
 THEN RAISE EXCEPTION 'Identificador já utilizado por outro pedido.'; END IF;
 RETURN r;
 END IF;
 SELECT * INTO e FROM public.time_entries WHERE id=p_entry AND user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR e.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Marcação inexistente ou cancelada.'; END IF;
 target_day := (e.timestamp AT TIME ZONE 'America/Sao_Paulo')::date;
 IF (p_timestamp AT TIME ZONE 'America/Sao_Paulo')::date <> target_day OR p_timestamp>now()
 THEN RAISE EXCEPTION 'Use um horário do mesmo dia da marcação, sem data futura.'; END IF;
 IF date_trunc('minute',p_timestamp)=date_trunc('minute',e.timestamp) THEN RAISE EXCEPTION 'Informe um horário diferente do registrado.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND attendance_start<=target_day)
 THEN RAISE EXCEPTION 'Data anterior ao início do controle.'; END IF;
 IF EXISTS(SELECT 1 FROM public.punch_change_requests WHERE entry_id=p_entry AND status='pending')
 THEN RAISE EXCEPTION 'Já existe um pedido pendente para esta marcação.'; END IF;
 IF EXISTS(SELECT 1 FROM public.time_entries x WHERE x.user_id=auth.uid() AND x.voided_at IS NULL AND x.id<>p_entry
 AND (x.timestamp AT TIME ZONE 'America/Sao_Paulo')::date=target_day
 AND ((array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],x.type)<array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],e.type) AND x.timestamp>=p_timestamp)
 OR (array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],x.type)>array_position(ARRAY['entry_1','exit_1','entry_2','exit_2'],e.type) AND x.timestamp<=p_timestamp)))
 THEN RAISE EXCEPTION 'Horário fora da ordem das marcações.'; END IF;
 INSERT INTO public.punch_change_requests(id,user_id,entry_id,original_timestamp,original_type,original_edited_at,requested_timestamp,reason)
 VALUES(p_id,auth.uid(),e.id,e.timestamp,e.type,e.edited_at,p_timestamp,trim(p_reason)) RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,after_data)
 VALUES(auth.uid(),'punch_change_requests',r.id,r.user_id,'request_change',r.reason,to_jsonb(r));
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.clock_adjust(p_user uuid, p_entry uuid, p_timestamp timestamptz, p_type text, p_reason text, p_void boolean DEFAULT false)
RETURNS public.time_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_r public.time_entries; r public.time_entries; target_day date; type_order int; BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador.'; END IF;
 IF p_user = auth.uid() THEN RAISE EXCEPTION 'Solicite a alteração em Meu ponto. Outro administrador deve analisar.'; END IF;
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


CREATE OR REPLACE FUNCTION public.clock_review_change(p_id uuid,p_status text,p_notes text)
RETURNS public.punch_change_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_r public.punch_change_requests; r public.punch_change_requests; e public.time_entries; BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Acesso restrito ao administrador.'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('approved','rejected') OR p_notes IS NULL OR length(trim(p_notes)) NOT BETWEEN 5 AND 1000
 THEN RAISE EXCEPTION 'Informe decisão e parecer de 5 a 1000 caracteres.'; END IF;
 SELECT * INTO old_r FROM public.punch_change_requests WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação inexistente.'; END IF;
 IF old_r.user_id=auth.uid() THEN RAISE EXCEPTION 'Outro administrador deve analisar sua solicitação.'; END IF;
 -- Reenvio da mesma decisão após falha de conexão não aplica o ajuste novamente.
 IF old_r.status<>'pending' THEN
 IF old_r.status=p_status AND old_r.reviewed_by=auth.uid() AND old_r.review_notes=trim(p_notes) THEN RETURN old_r; END IF;
 RAISE EXCEPTION 'Solicitação já analisada. Atualize a lista.';
 END IF;
 IF p_status='approved' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended(old_r.user_id::text,0));
 SELECT * INTO e FROM public.time_entries WHERE id=old_r.entry_id FOR UPDATE;
 IF NOT FOUND OR e.voided_at IS NOT NULL OR e.user_id IS DISTINCT FROM old_r.user_id
 OR e.timestamp IS DISTINCT FROM old_r.original_timestamp OR e.type IS DISTINCT FROM old_r.original_type
 OR e.edited_at IS DISTINCT FROM old_r.original_edited_at THEN
 RAISE EXCEPTION 'A marcação mudou após o pedido. Recuse este pedido e solicite um novo.'; END IF;
 PERFORM public.clock_adjust(old_r.user_id,old_r.entry_id,old_r.requested_timestamp,old_r.original_type,
 'Pedido ' || old_r.id::text || ' aprovado. Parecer completo no histórico do pedido.',false);
 END IF;
 UPDATE public.punch_change_requests SET status=p_status,review_notes=trim(p_notes),reviewed_by=auth.uid(),reviewed_at=now()
 WHERE id=p_id RETURNING * INTO r;
 INSERT INTO public.audit_events(actor_id,entity,entity_id,subject_id,action,reason,before_data,after_data)
 VALUES(auth.uid(),'punch_change_requests',r.id,r.user_id,'review_change',trim(p_notes),to_jsonb(old_r),to_jsonb(r));
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.clock_request_change(uuid,uuid,timestamptz,text),public.clock_review_change(uuid,text,text),public.clock_adjust(uuid,uuid,timestamptz,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.clock_request_change(uuid,uuid,timestamptz,text),public.clock_review_change(uuid,text,text),public.clock_adjust(uuid,uuid,timestamptz,text,text,boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
