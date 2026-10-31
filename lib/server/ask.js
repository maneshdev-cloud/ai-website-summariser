// "Ask this page" — Q&A over one extraction.
//
// Answers can only come from the extracted page text, never from the
// model's own knowledge. It also has to say whether the page actually
// covers the question ({ covered, answer }), so the UI can show
// "not covered" instead of dressing up a guess. Without an API key,
// extractive.js answers in the same way.
import { chatJSON, hasGroqKey, MODELS } from './groq.js';
import { extractiveAnswer } from './extractive.js';
import { splitIntoChunks } from './chunk.js';

// Pages up to this size go into the prompt whole.
const WHOLE_TEXT_LIMIT = 12000;
const TOP_CHUNKS = 3; // best-matching chunks sent for longer pages

const STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
  'does', 'did', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'of', 'in',
  'on', 'to', 'for', 'and', 'or', 'about', 'this', 'that', 'it', 'its',
]);

// For long pages, pick the chunks that best match the question instead of
// just sending the start of the article — questions about later sections
// would never get answered that way, and sending everything at once
// runs into rate limits fast.
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
  let raw;
  try {
    raw = await chatJSON({
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
  } catch {
    // Groq errored (usually the free-tier rate limit) — answer with the
    // extractive retriever instead of failing the question outright.
    const { covered, answer } = extractiveAnswer(extraction.text, question);
    return { covered, answer, engine: 'demo-extractive' };
  }

  const covered = raw?.covered === true;
  const answer =
    typeof raw?.answer === 'string' && raw.answer.trim()
      ? raw.answer.trim()
      : covered
        ? 'The page covers this, but no clear answer could be extracted.'
        : "This page doesn't cover that.";
  return { covered, answer, engine: 'groq' };
}
