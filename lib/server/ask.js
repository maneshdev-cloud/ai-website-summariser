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

/** Cap the context sent to the model (~6k tokens) to stay fast and cheap. */
const MAX_CONTEXT_CHARS = 24000;

export async function answerQuestion(extraction, question) {
  if (!hasGroqKey()) {
    const { covered, answer } = extractiveAnswer(extraction.text, question);
    return { covered, answer, engine: 'demo-extractive' };
  }

  const context = extraction.text.slice(0, MAX_CONTEXT_CHARS);
  const raw = await chatJSON({
    model: MODELS.summary,
    temperature: 0.1,
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
