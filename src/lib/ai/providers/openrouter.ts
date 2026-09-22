import OpenAI from 'openai'
import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  type ProviderArgs,
} from './shared'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim()
  const title = process.env.OPENROUTER_APP_TITLE?.trim()
  if (referer) headers['HTTP-Referer'] = referer
  if (title) headers['X-OpenRouter-Title'] = title
  return headers
}

/** Convert OpenAI-SDK/OpenRouter failures into the shared typed errors. */
export function toOpenRouterError(err: unknown): AiError {
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiError('OpenRouter took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new AiError('Could not reach OpenRouter.', {
      code: 'network_error',
      status: 502,
    })
  }
  if (!(err instanceof OpenAI.APIError)) {
    return new AiError('OpenRouter request failed.', {
      code: 'provider_error',
      status: 502,
    })
  }

  const status = err.status ?? 502
  const detail = err.message?.trim()
  let code = 'provider_error'
  let message = `OpenRouter API error (${status})`
  let responseStatus = 502

  if (
    status === 404 ||
    (status === 400 && /\b(model|model id|model identifier)\b/i.test(detail ?? ''))
  ) {
    code = 'invalid_model'
    message = 'OpenRouter rejected the selected model'
    responseStatus = 400
  } else if (status === 400 || status === 422) {
    code = 'invalid_request'
    message = 'OpenRouter rejected the request'
    responseStatus = 400
  } else if (status === 401) {
    code = 'invalid_key'
    message = 'OpenRouter rejected the API key'
    responseStatus = 401
  } else if (status === 402) {
    code = 'insufficient_credits'
    message = 'OpenRouter account or API key has insufficient credits'
    responseStatus = 402
  } else if (status === 403) {
    code = 'provider_forbidden'
    message = 'OpenRouter denied the request'
    responseStatus = 403
  } else if (status === 408) {
    code = 'timeout'
    message = 'OpenRouter took too long to respond'
    responseStatus = 504
  } else if (status === 429) {
    code = 'rate_limited'
    message = 'OpenRouter rate limit reached'
    responseStatus = 429
  } else if (status === 502 || status === 503) {
    code = 'provider_unavailable'
    message = 'OpenRouter or the selected upstream model is unavailable'
  }

  return new AiError(detail ? `${message}: ${detail}` : message, {
    code,
    status: responseStatus,
  })
}

/**
 * Call OpenRouter through its OpenAI-compatible Chat Completions API.
 * Model IDs stay as unrestricted user input so any current OpenRouter
 * model slug can be selected without an application release.
 */
export async function generateOpenRouter(
  args: ProviderArgs,
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: attributionHeaders(),
    timeout: timeoutMs,
    // Draft/auto-reply callers already have strict latency and send
    // semantics. Avoid hidden SDK retries that can exceed that budget.
    maxRetries: 0,
  })

  let completion: OpenAI.Chat.Completions.ChatCompletion
  try {
    completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...mergeConsecutive(messages),
      ],
      max_tokens: MAX_OUTPUT_TOKENS,
    })
  } catch (err) {
    throw toOpenRouterError(err)
  }

  const text = completion.choices[0]?.message?.content
  if (!text || !text.trim()) {
    throw new AiError('OpenRouter returned an empty response.', {
      code: 'empty_response',
    })
  }

  const usage = normalizeUsage({
    prompt: completion.usage?.prompt_tokens,
    completion: completion.usage?.completion_tokens,
    total: completion.usage?.total_tokens,
  })
  return { text, usage }
}
