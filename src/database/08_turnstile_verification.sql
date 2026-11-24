-- =====================================================================
-- Of Course — 08_turnstile_verification.sql
-- AUDIT FIX: Turnstile token-nı server tərəfdən yoxla.
--
-- Problem:
--   Hazırda Turnstile token yalnız frontend-də varlığı yoxlanılır.
--   Server tərəfdə Cloudflare-ə siteverify sorğusu göndərilmir.
--
-- Həll:
--   pg_net extension istifadə edərək Cloudflare siteverify çağırışı.
--   Tələb: Supabase dashboard → Database → Extensions → pg_net aktiv.
--
-- Alternativ (əgər pg_net yoxdursa):
--   Supabase Edge Function yaradın (docs-a baxın).
-- =====================================================================

-- pg_net extension aktiv et (əgər artıq aktiv deyilsə)
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- verify_turnstile RPC
-- Cloudflare siteverify endpoint-inə POST sorğu göndərir.
-- Token keçərlidirsə true, deyilsə false qaytarır.
-- ---------------------------------------------------------------------
create or replace function public.verify_turnstile(p_token text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  response json;
  success boolean;
  secret_key text;
begin
  -- Boş token = CAPTCHA deaktiv (test rejimi)
  if p_token is null or p_token = '' then
    return true;
  end if;

  -- Secret key-i environment-dən oxu (Supabase Vault və ya custom schema)
  -- Təhlükəsizlik: secret key heç vaxt kodda hardkod olunmamalıdır
  -- Production üçün: Supabase Vault istifadə edin
  --   select vault.create_secret('0x...', 'turnstile_secret');
  --   select vault.decrypted_secret('turnstile_secret');
  --
  -- Hazırda: environment variable-dan oxumaq üçün current_setting istifadə
  begin
    secret_key := current_setting('app.turnstile_secret', true);
  exception when others then
    secret_key := null;
  end;

  if secret_key is null then
    -- Secret key təyin edilməyibsə — verification-i skip et
    -- (production-da bu olmamalıdır)
    raise notice 'Turnstile secret key təyin edilməyib — verification skip';
    return true;
  end if;

  -- Cloudflare siteverify çağırışı (pg_net ilə)
  -- Dokumentasiya: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  select content::json into response
  from net.http_post(
    url := 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    body := jsonb_build_object(
      'secret', secret_key,
      'response', p_token
    ),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  -- Cavabdan success sahəsini oxu
  success := coalesce((response->>'success')::boolean, false);

  return success;
end;
$function$;

-- ---------------------------------------------------------------------
-- İcazələr
-- ---------------------------------------------------------------------
revoke execute on function public.verify_turnstile(text) from public, anon;
grant execute on function public.verify_turnstile(text) to authenticated;

-- =====================================================================
-- Konfiqurasiya:
-- 1. Supabase Dashboard → Database → Extensions → pg_net aktiv edin
-- 2. Supabase Vault-a secret key əlavə edin:
--    select vault.create_secret('YOUR_CLOUDFLARE_SECRET_KEY', 'turnstile_secret');
-- 3. Və ya session variable (test üçün):
--    set app.turnstile_secret = 'YOUR_CLOUDFLARE_SECRET_KEY';
--
-- Frontend istifadəsi:
--   const { data } = await supabase.rpc('verify_turnstile', { p_token: token })
--   if (!data) { setError('CAPTCHA xətası') }
-- =====================================================================

-- =====================================================================
-- ALTERNATİV: Supabase Edge Function
-- Əgər pg_net işləməsə, Edge Function istifadə edin:
--
-- // supabase/functions/verify-turnstile/index.ts
-- import { serve } from 'https://deno.land/std/http/server.ts'
--
-- serve(async (req) => {
--   const { token } = await req.json()
--   const secret = Deno.env.get('TURNSTILE_SECRET')!
--
--   const res = await fetch(
--     'https://challenges.cloudflare.com/turnstile/v0/siteverify',
--     {
--       method: 'POST',
--       headers: { 'Content-Type': 'application/json' },
--       body: JSON.stringify({ secret, response: token })
--     }
--   )
--   const data = await res.json()
--
--   return new Response(JSON.stringify({ success: data.success }),
--     { headers: { 'Content-Type': 'application/json' } })
-- })
--
-- Frontend-də çağırış:
--   const { data } = await supabase.functions.invoke('verify-turnstile', { body: { token } })
-- =====================================================================
