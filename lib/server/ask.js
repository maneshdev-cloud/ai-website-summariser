/**
 * "Ask this page" — grounded question answering over one extraction.
 *
 * The contract is strict: answers may only use the extracted page text.
 * The model is instructed (at low temperature) to say the page doesn't
 * cover the question when the answer isn't there, and to return a
 * machine-readable { covered, answer } verdict so the UI can show the
 * distinction honestly instead of dressing up a guess.
 *
 * Without an API key, the same contract is kept by the extractive
 * retriever in extractive.js.
 */
import { chatJSON, hasGroqKey, MODELS } from './groq.js';
import { extractiveAnswer } from './extractive.js';
import { splitIntoChunks } from './chunk.js';

/** Below this size the whole page fits comfortably in one prompt. */
const WHOLE_TEXT_LIMIT = 12000;
/** How many of the best-matching chunks to send for longer pages. */
const TOP_CHUNKS = 3;

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'does', 'did', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'in',
  'on', 'to', 'for', 'and', 'or', 'about', 'this', 'that', 'it', 'its',
]);

/**
 * Pick the context for a question. Short pages go in whole. For long
 * pages, sending just the opening (the naive approach) means questions
 * about later sections can never be answered — and sending everything
 * blows token rate limits. Instead, score the page's chunks by keyword
 * overlap with the question and send the best few, in page order: a
 * small, honest retrieval step.
 */
export function selectContext(text, question) {
  if (text.length <= WHOLE_TEXT_LIMIT) return text;
  const { chunks } = splitIntoChunks(text);
  const terms = [...new Set(
    question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  )];
  if (!terms.length) return chunks.slice(0, TOP_CHUNKS).join('\n\n');
  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.split(term).length - 1), 0);
    return { chunk, index, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CHUNKS)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.chunk)
    .join('\n\n');
}

export async function answerQuestion(extraction, question) {
  if (!hasGroqKey()) {
    const { covered, answer } = extractiveAnswer(extraction.text, question);
    return { covered, answer, engine: 'demo-extractive' };
  }

  const context = selectContext(extraction.text, question);
  const raw = await chatJSON({
    model: MODELS.fast,
    temperature: 0.1,
    reasoningEffort: 'low',
    messages: [
      {
        role: 'system',
        content:
          'You answer questions strictly from the provided page text. You never use outside knowledge and never guess. You always respond with a single JSON object.',
      },
      {
        role: 'user',
        content: [
          'Given the page text below, answer the question using ONLY facts stated in it.',
          '',
          'Return a JSON object:',
          '- "covered": true if the text contains the answer, otherwise false.',
          '- "answer": if covered, a concise answer (max 120 words) grounded in the text; if not covered, a sentence beginning "This page doesn\'t cover that" explaining what the page is about instead.',
          '',
          `QUESTION: ${question}`,
          '',
          'PAGE TEXT:',
          context,
        ].join('\n'),
      },
    ],
  });

  const covered = raw?.covered === true;
  const answer =
    typeof raw?.answer === 'string' && raw.answer.trim()
      ? raw.answer.trim()
      : covered
        ? 'The page covers this, but no clear answer could be extracted.'
        : "This page doesn't cover that.";
  return { covered, answer, engine: 'groq' };
}
