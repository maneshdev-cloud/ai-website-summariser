/**
 * Minimal Groq client built on native fetch (no SDK dependency).
 *
 * Groq exposes an OpenAI-compatible chat completions API, so a call is
 * just a POST with a bearer token. The key is read from the GROQ_API_KEY
 * environment variable on the server — it is never hardcoded, never
 * committed, and never sent to the browser.
 *
 * Two models are used:
 *  - SUMMARY_MODEL (default openai/gpt-oss-120b): the "reduce" step and
 *    single-shot summaries, where quality matters most.
 *  - FAST_MODEL (default openai/gpt-oss-20b): the per-chunk "map" steps,
 *    which are simple, repetitive, and benefit from speed.
 * Both can be overridden via environment variables (see .env.example).
 */
import { ApiError } from './errors.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60000;

export const MODELS = {
  summary: process.env.GROQ_MODEL_SUMMARY || 'openai/gpt-oss-120b',
  fast: process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b',
};

export function hasGroqKey() {
  return Boolean(process.env.GROQ_API_KEY);
}

/**
 * One chat completion. Returns the message content as a string.
 * With `jsonMode: true`, Groq is asked for a JSON object response; the
 * content is still returned raw — parsing/validation is the caller's job
 * (see chatJSON).
 */
export async function chatCompletion({ model, messages, temperature = 0.3, jsonMode = false, maxTokens, reasoningEffort, _isRetry = false }) {
  if (!hasGroqKey()) {
    throw new ApiError(500, 'AI_NOT_CONFIGURED', 'GROQ_API_KEY is not set on the server.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(502, 'AI_TIMEOUT', 'The AI model took too long to respond. Please try again.');
    }
    throw new ApiError(502, 'AI_UNREACHABLE', 'Could not reach the AI service. Please try again.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Include a short slice of the provider's error to aid debugging, but
    // never the key or the full request.
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new ApiError(
      502,
      'AI_UPSTREAM_ERROR',
      `The AI service returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    // Reasoning models occasionally return an empty message (the whole
    // budget spent on reasoning). A single retry almost always succeeds,
    // so try once more before giving up.
    if (!_isRetry) {
      return chatCompletion({ model, messages, temperature, jsonMode, maxTokens, reasoningEffort, _isRetry: true });
    }
    throw new ApiError(502, 'AI_BAD_RESPONSE', 'The AI service returned an empty response.');
  }
  return content;
}

/**
 * Chat completion expecting a JSON object back. Parsing is defensive:
 * models occasionally wrap JSON in code fences despite JSON mode, so
 * fences are stripped before parsing.
 */
export async function chatJSON(options) {
  const content = await chatCompletion({ ...options, jsonMode: true });
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ApiError(502, 'AI_BAD_RESPONSE', 'The AI service returned malformed JSON.');
  }
}
