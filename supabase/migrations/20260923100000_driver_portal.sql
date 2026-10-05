-- Aplicar depois de 20260921120000_secure_time_clock.sql. Não apaga ou desativa contas existentes.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'team' CHECK(account_kind IN ('team','driver'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cpf_last4 text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_company text;

-- Somente app_metadata escrita pela API administrativa do Auth determina conta de motorista.
CREATE OR REPLACE FUNCTION public.clock_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE driver boolean := coalesce(NEW.raw_app_meta_data->>'account_kind','')='driver';
BEGIN
 INSERT INTO public.profiles(id,name,email,role,active,attendance_start,account_kind,cpf_last4,driver_company,job_title)
 VALUES(NEW.id,left(coalesce(nullif(NEW.raw_user_meta_data->>'name',''),'Colaborador'),120),NEW.email,
 'employee',false,(now() AT TIME ZONE 'America/Sao_Paulo')::date,
 CASE WHEN driver THEN 'driver' ELSE 'team' END,
 CASE WHEN driver THEN right(NEW.raw_user_meta_data->>'cpf_last4',4) END,
 CASE WHEN driver THEN left(NEW.raw_user_meta_data->>'driver_company',120) END,
 CASE WHEN driver THEN 'Motorista' END)
 ON CONFLICT(id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clock_new_user() FROM PUBLIC,anon,authenticated;

-- Persistência da limitação de tentativas entre instâncias da Edge Function.
CREATE TABLE IF NOT EXISTS public.driver_auth_limits (
 bucket_key text PRIMARY KEY,
 window_start timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0
);
ALTER TABLE public.driver_auth_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_auth_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.driver_take_attempt(p_key text,p_limit integer,p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE counter integer;
BEGIN
 IF p_key IS NULL OR length(p_key)>150 OR p_limit IS NULL OR p_seconds IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_seconds NOT BETWEEN 1 AND 3600 THEN RAISE EXCEPTION 'Parâmetros inválidos'; END IF;
 INSERT INTO public.driver_auth_limits(bucket_key,window_start,attempts) VALUES(p_key,clock_timestamp(),1)
 ON CONFLICT(bucket_key) DO UPDATE SET
 attempts=CASE WHEN driver_auth_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) THEN 1 ELSE least(driver_auth_limits.attempts+1,p_limit+1) END,
 window_start=CASE WHEN driver_auth_limits.window_start < clock_timestamp()-make_interval(secs=>p_seconds) THEN clock_timestamp() ELSE driver_auth_limits.window_start END
 RETURNING attempts INTO counter;
 -- TTL: nenhum CPF/IP em claro, somente HMAC, retenção máxima prática de 48h.
 DELETE FROM public.driver_auth_limits WHERE window_start < now()-interval '48 hours';
 RETURN counter<=p_limit;
END $$;
REVOKE ALL ON FUNCTION public.driver_take_attempt(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.driver_take_attempt(text,integer,integer) TO service_role;
GRANT SELECT ON public.profiles TO service_role;
GRANT INSERT ON public.audit_events TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
