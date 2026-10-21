CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_select_all" ON public.app_config;

CREATE POLICY "app_config_select_all" ON public.app_config
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "app_config_no_client_write" ON public.app_config;

REVOKE INSERT, UPDATE, DELETE ON public.app_config FROM anon, authenticated;

GRANT SELECT ON public.app_config TO anon, authenticated;

INSERT INTO public.app_config (key, value, updated_at)
VALUES ('map_gl_enabled', 'false'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
