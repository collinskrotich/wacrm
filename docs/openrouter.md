# OpenRouter AI provider

OpenRouter is available as a third, independent provider under
**Settings → AI Assistant**. It uses OpenRouter's OpenAI-compatible
Chat Completions endpoint and accepts any non-empty OpenRouter model
identifier; the application does not maintain a model allowlist.

Examples include:

- `openai/gpt-4o-mini`
- `anthropic/claude-sonnet-4`
- `google/gemini-2.5-flash`

Model availability changes over time. Copy the current identifier from
the OpenRouter model catalog if one of these examples is unavailable.

## Account setup

1. Apply `supabase/migrations/043_openrouter_provider.sql` before
   selecting OpenRouter. It extends the provider constraints on both
   `ai_configs` and `ai_usage_log`.
2. Open **Settings → AI Assistant** and select **OpenRouter**.
3. Enter the model identifier and the account's OpenRouter API key.
4. Click **Test key**. This performs a small Chat Completions request
   with that exact key and model, without saving either value.
5. Save the configuration, then enable the assistant and optionally
   automatic replies.

The key is encrypted with the existing `ENCRYPTION_KEY` using
AES-256-GCM. The API returns only a `has_key` flag, never the encrypted
or plaintext value. Drafts, Playground replies, and automatic WhatsApp
replies all use the same account-scoped provider and model.

## Environment variables

There is no deployment-wide OpenRouter API key. Each account stores its
own key through the settings UI.

These runtime variables are optional and contain no credentials:

```dotenv
OPENROUTER_HTTP_REFERER=https://crm.example.com
OPENROUTER_APP_TITLE=Tavany whatsapp CRM
```

They populate OpenRouter's optional `HTTP-Referer` and
`X-OpenRouter-Title` attribution headers. The existing
`AI_REQUEST_TIMEOUT_MS` applies to OpenRouter as well and defaults to
30 seconds.

## Deploy on an existing AWS EC2 Docker Compose host

The commands below assume the repository already runs on EC2 with
`.env.local`, Docker Compose v2, and a linked hosted Supabase project.

1. SSH to EC2 and enter the repository:

   ```bash
   ssh -i /path/to/key.pem ec2-user@YOUR_EC2_HOST
   cd /path/to/wacrm
   ```

2. Pull the release and optionally add the attribution variables to
   `.env.local`:

   ```bash
   git pull --ff-only
   printf '\nOPENROUTER_HTTP_REFERER=https://crm.example.com\nOPENROUTER_APP_TITLE=Tavany whatsapp CRM\n' >> .env.local
   ```

   Skip the `printf` command when attribution is not wanted. Never put
   an OpenRouter API key in `.env.local`.

3. Apply pending migrations to the existing Supabase project. If this
   host is not linked yet, link it first:

   ```bash
   npx supabase login --token "$SUPABASE_ACCESS_TOKEN"
   npx supabase link \
     --project-ref "$SUPABASE_PROJECT_REF" \
     --password "$SUPABASE_DB_PASSWORD"
   npx supabase db push
   ```

   `db push` must include `043_openrouter_provider.sql`. Do this before
   saving OpenRouter in the UI or PostgreSQL will reject the provider.

4. Rebuild and replace the application container. The `--env-file`
   flag is required because this project uses `.env.local`:

   ```bash
   docker compose --env-file .env.local up --build -d
   docker compose --env-file .env.local ps
   docker compose --env-file .env.local logs --tail=100 app
   ```

5. Verify the HTTP service locally on EC2, then test OpenRouter through
   the settings page:

   ```bash
   curl -fsS "http://127.0.0.1:${HOST_PORT:-3000}/" >/dev/null
   ```

   In **Settings → AI Assistant**, select OpenRouter, enter the key and
   model, click **Test key**, save, and use the inbox draft button. If
   automatic replies are enabled, send a WhatsApp message into an
   unassigned conversation and confirm that the AI-generated reply is
   delivered.

## Failure behavior

- Invalid or disabled keys return `invalid_key`.
- Invalid model identifiers return `invalid_model`; other malformed
  requests return `invalid_request`.
- Insufficient credits return `insufficient_credits`.
- Rate limits return `rate_limited` without hidden SDK retries.
- Request timeouts return `timeout`; upstream outages return
  `provider_unavailable` or `provider_error`.

Provider failures do not bypass the existing automatic-reply cap,
handoff rules, conversation ownership checks, Flow precedence, or
WhatsApp delivery path.
