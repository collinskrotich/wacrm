import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AI_REQUEST_TIMEOUT_MS
  delete process.env.OPENROUTER_HTTP_REFERER
  delete process.env.OPENROUTER_APP_TITLE
})

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

describe('generateReply — OpenRouter', () => {
  function openRouterResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function openRouterConfig(overrides: Partial<AiConfig> = {}): AiConfig {
    return config({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      apiKey: 'sk-or-v1-test',
      ...overrides,
    })
  }

  it('uses the OpenAI-compatible endpoint with an unrestricted model ID', async () => {
    process.env.OPENROUTER_HTTP_REFERER = 'https://crm.example.com'
    process.env.OPENROUTER_APP_TITLE = 'Tavany whatsapp CRM'
    const fetchMock = vi.fn().mockResolvedValue(
      openRouterResponse(200, {
        id: 'gen-1',
        object: 'chat.completion',
        created: 1,
        model: 'google/gemini-2.5-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Happy to help!' },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateReply({
      config: openRouterConfig({ model: 'google/gemini-2.5-flash' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result).toEqual({
      text: 'Happy to help!',
      handoff: false,
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    })
    const [input, init] = fetchMock.mock.calls[0]
    const url = typeof input === 'string' ? input : input.url
    const headers = new Headers(init.headers)
    const body = JSON.parse(String(init.body))
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(headers.get('authorization')).toBe('Bearer sk-or-v1-test')
    expect(headers.get('http-referer')).toBe('https://crm.example.com')
    expect(headers.get('x-openrouter-title')).toBe('Tavany whatsapp CRM')
    expect(body.model).toBe('google/gemini-2.5-flash')
  })

  it.each([
    [401, 'Invalid API key', 'invalid_key', 401],
    [400, 'Model not found: vendor/not-a-model', 'invalid_model', 400],
    [422, 'Invalid request parameter', 'invalid_request', 400],
    [429, 'Rate limit exceeded', 'rate_limited', 429],
    [503, 'No provider available', 'provider_unavailable', 502],
  ])(
    'maps an OpenRouter %s response to %s',
    async (status, message, code, mappedStatus) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          openRouterResponse(status, { error: { code: status, message } }),
        ),
      )

      await expect(
        generateReply({
          config: openRouterConfig(),
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      ).rejects.toMatchObject({ code, status: mappedStatus })
    },
  )

  it('times out a slow OpenRouter request', async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '5'
    vi.stubGlobal(
      'fetch',
      vi.fn((_input, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          const abort = () => reject(signal?.reason ?? new Error('aborted'))
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        }),
      ),
    )

    await expect(
      generateReply({
        config: openRouterConfig(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'timeout', status: 504 })
  })
})
