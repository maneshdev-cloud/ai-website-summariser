// The summarise pipeline. Text gets chunked (see chunk.js), then either
// one LLM call for a short page, or map-reduce for a long one: the fast
// model compresses each chunk, the bigger model merges those into the
// final summary. The model's JSON is checked against the shape the UI
// renders: { tldr, keyPoints, detailedSummary, topics, tone }.
//
// Brief/standard/detailed only change this step — the extraction is
// reused, never re-fetched. No key (or Groq down) falls back to the
// extractive summariser, labelled "demo-extractive" so a fallback never
// passes itself off as an LLM result.
import { ApiError } from './errors.js';
import { splitIntoChunks, countWords } from './chunk.js';
import { chatCompletion, chatJSON, hasGroqKey, MODELS } from './groq.js';
import { extractiveSummary } from './extractive.js';

export const LENGTH_MODES = ['brief', 'standard', 'detailed'];

const MODE_SPECS = {
  brief: { keyPoints: 'exactly 5', detailWords: '80–120' },
  standard: { keyPoints: '5–7', detailWords: '180–240' },
  detailed: { keyPoints: 'exactly 7', detailWords: '350–500' },
};

// Whatever the model returned gets forced into the shape, or it throws.
export function validateSummary(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new ApiError(502, 'AI_BAD_RESPONSE', 'The AI service returned an unexpected format.');
  }
  const asString = (v) => (typeof v === 'string' ? v.trim() : '');
  const asStringArray = (v, max) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, max)
      : [];

  const summary = {
    tldr: asString(raw.tldr),
    keyPoints: asStringArray(raw.keyPoints, 7),
    detailedSummary: asString(raw.detailedSummary),
    topics: asStringArray(raw.topics, 8),
    tone: asString(raw.tone) || 'Neutral',
  };
  if (!summary.tldr || !summary.detailedSummary || summary.keyPoints.length < 3) {
    throw new ApiError(502, 'AI_BAD_RESPONSE', 'The AI summary was incomplete. Please try again.');
  }
  return summary;
}

function summaryMessages(content, mode, isReduce) {
  const spec = MODE_SPECS[mode] || MODE_SPECS.standard;
  return [
    {
      role: 'system',
      content:
        'You are a precise summarisation engine. You only use facts present in the provided text — never invent details, names, or numbers. You always respond with a single JSON object.',
    },
    {
      role: 'user',
      content: [
        `Summarise the ${isReduce ? 'combined section summaries of a web page' : 'web page text'} below.`,
        '',
        'Return a JSON object with exactly these fields:',
        '- "tldr": one sentence (max 30 words) capturing the whole point.',
        `- "keyPoints": an array of ${spec.keyPoints} strings, each one key fact or takeaway, one line each.`,
        `- "detailedSummary": a coherent summary of ${spec.detailWords} words.`,
        '- "topics": an array of 3–6 short topic tags.',
        '- "tone": one or two words describing the writing tone (e.g. "Analytical", "Conversational").',
        '',
        'TEXT:',
        content,
      ].join('\n'),
    },
  ];
}

async function summariseWithGroq(text, mode) {
  const { chunks, totalChunks, truncated } = splitIntoChunks(text);
  const mapReduce = chunks.length > 1;
  let summary;

  if (!mapReduce) {
    const raw = await chatJSON({
      model: MODELS.summary,
      messages: summaryMessages(chunks[0] ?? text, mode, false),
      temperature: 0.3,
    });
    summary = validateSummary(raw);
  } else {
    // map step: compress each chunk on its own with the fast model
    const chunkSummaries = [];
    for (const chunk of chunks) {
      let piece;
      try {
        piece = await chatCompletion({
          model: MODELS.fast,
          temperature: 0.2,
          reasoningEffort: 'low',
          messages: [
            {
              role: 'system',
              content:
                'You compress one section of a longer article. Keep every fact, name, figure and claim; drop filler. Reply with plain text only.',
            },
            {
              role: 'user',
              content: `Compress this section into 120–180 words:\n\n${chunk}`,
            },
          ],
        });
      } catch {
        // One bad chunk shouldn't fail the whole summary — use its first
        // sentences instead, so the reduce step still sees this section.
        piece = chunk.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
      }
      chunkSummaries.push(piece.trim());
    }
    // reduce step: one structured summary over all the chunk summaries
    const raw = await chatJSON({
      model: MODELS.summary,
      messages: summaryMessages(chunkSummaries.join('\n\n'), mode, true),
      temperature: 0.3,
    });
    summary = validateSummary(raw);
  }

  return { summary, chunkCount: chunks.length, totalChunks, truncated, mapReduce };
}

export async function summariseExtraction(extraction, mode) {
  const { chunks, totalChunks, truncated } = splitIntoChunks(extraction.text);
  const chunkInfo = {
    chunkCount: chunks.length,
    totalChunks,
    truncated,
    mapReduce: chunks.length > 1,
  };

  if (!hasGroqKey()) {
    return {
      summary: extractiveSummary(extraction.text, mode),
      engine: 'demo-extractive',
      models: null,
      ...chunkInfo,
    };
  }

  try {
    const result = await summariseWithGroq(extraction.text, mode);
    return {
      summary: result.summary,
      engine: 'groq',
      models: { summary: MODELS.summary, fast: MODELS.fast },
      chunkCount: result.chunkCount,
      totalChunks: result.totalChunks,
      truncated: result.truncated,
      mapReduce: result.mapReduce,
    };
  } catch (err) {
    // A provider outage shouldn't kill the demo: fall back, but say so.
    if (err instanceof ApiError) {
      return {
        summary: extractiveSummary(extraction.text, mode),
        engine: 'demo-extractive',
        models: null,
        fallbackNote: `The AI service was unavailable (${err.message}), so this summary was produced by the built-in extractive fallback.`,
        ...chunkInfo,
      };
    }
    throw err;
  }
}

export function summaryStats(extraction, summary) {
  const words = countWords(
    [summary.tldr, ...summary.keyPoints, summary.detailedSummary].join(' '),
  );
  const summaryMinutes = Math.max(1, Math.round(words / 200));
  return {
    summaryWordCount: words,
    summaryReadingTimeMinutes: summaryMinutes,
    readingTimeSavedMinutes: Math.max(0, extraction.readingTimeMinutes - summaryMinutes),
  };
}
