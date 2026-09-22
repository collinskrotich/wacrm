-- ============================================================
-- 043_openrouter_provider.sql — allow OpenRouter as an AI provider
--
-- Provider values are constrained both on the account configuration
-- and on the append-only usage log. Replace both original two-provider
-- checks so existing OpenAI / Anthropic rows remain valid while new
-- OpenRouter configurations and usage records can be written.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));
