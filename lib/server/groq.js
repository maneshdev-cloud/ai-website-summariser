// Small Groq client on plain fetch — Groq's API is OpenAI-shaped, so no
// SDK is needed. The key comes from GROQ_API_KEY and stays on the server.
// gpt-oss-120b does the final summary, gpt-oss-20b the per-chunk steps
// (quicker, and those calls are simple). Both can be changed via env.
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
    // A bit of the provider's error message helps debugging. Never the key.
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
    // Reasoning models sometimes come back empty (all the tokens went on
    // reasoning). Retrying once nearly always works, so do that first.
    if (!_isRetry) {
      return chatCompletion({ model, messages, temperature, jsonMode, maxTokens, reasoningEffort, _isRetry: true });
    }
    throw new ApiError(502, 'AI_BAD_RESPONSE', 'The AI service returned an empty response.');
  }
  return content;
}

// Same as above but expects a JSON object back. Models still sometimes
// wrap JSON in code fences even in JSON mode, so strip them before parsing.
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
