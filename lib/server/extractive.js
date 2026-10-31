// Fallback summariser for when there's no Groq key — plain extractive
// summarising, no model involved. Sentences get scored by how frequent
// their content words are (early sentences get a boost, articles
// front-load the facts). Best sentence becomes the TL;DR, next best are
// the key points, and the top few put back in original order make the
// detailed summary.
//
// It's basic next to the LLM path, so anything from here is labelled
// "demo-extractive" and the UI badges it as such. Also used for keyless
// Q&A: best-matching sentences, or "not covered" if nothing matches.

const STOPWORDS = new Set(
  (
    'a an the and or but if then else when while of at by for with about into through after over ' +
    'before between out against during without before under around among is are was were be been ' +
    'being have has had having do does did doing would should could ought i you he she it we they ' +
    'them his her its our their this that these those am an as so than too very can will just ' +
    'should now from to in on not no yes also more most other some such only own same don'
  ).split(' '),
);

export function splitSentences(text) {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  return (flat.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) || [])
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function contentWords(text) {
  return (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOPWORDS.has(w));
}

function wordFrequencies(text) {
  const freq = new Map();
  for (const word of contentWords(text)) freq.set(word, (freq.get(word) || 0) + 1);
  return freq;
}

// Drop Wikipedia-style citations like [16] or [note 1].
function stripCitations(sentence) {
  return sentence
    .replace(/\s*\[(?:\d+|note\s*\d+|citation needed)\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Section furniture ("External links", "References"), reference-list
// entries and tiny fragments are never summary material.
function isJunkSentence(sentence) {
  const clean = stripCitations(sentence);
  if (clean.length < 40) return true;
  if (/^(external links|references|see also|further reading|bibliography|notes)\b/i.test(clean)) {
    return true;
  }
  const citations = (sentence.match(/\[\d+\]/g) || []).length;
  return citations >= 3;
}

function scoreSentences(sentences, freq) {
  const total = sentences.length;
  return sentences.map((sentence, index) => {
    const words = contentWords(sentence);
    if (!words.length) return { sentence, index, score: 0 };
    const raw = words.reduce((sum, w) => sum + (freq.get(w) || 0), 0) / Math.sqrt(words.length);
    const positionBoost = index < 3 ? 1.25 : 1; // lead sentences carry the story
    // Back-matter (references etc.) shouldn't win on word frequency
    // alone, so scores fade a bit with depth.
    const depthDecay = 1 - 0.25 * (total > 1 ? index / (total - 1) : 0);
    return { sentence, index, score: raw * positionBoost * depthDecay };
  });
}

function topTopics(freq, count) {
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const MODE_COUNTS = {
  brief: { keyPoints: 4, detailSentences: 5 },
  standard: { keyPoints: 6, detailSentences: 8 },
  detailed: { keyPoints: 7, detailSentences: 12 },
};

export function extractiveSummary(text, mode = 'standard') {
  const sentences = splitSentences(text).filter((s) => !isJunkSentence(s));
  const freq = wordFrequencies(text);
  const scored = scoreSentences(sentences, freq);
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const counts = MODE_COUNTS[mode] || MODE_COUNTS.standard;

  // TL;DR has to come from the lead of the article, that's where the
  // defining sentence is — best score out of the first 20.
  const leadPool = scored.slice(0, 20).sort((a, b) => b.score - a.score);
  const tldrPick = leadPool[0] || byScore[0];
  const tldr = truncate(stripCitations(tldrPick?.sentence || sentences[0] || ''), 260);

  const pointPicks = byScore
    .filter((s) => s.sentence !== (tldrPick?.sentence ?? ''))
    .slice(0, counts.keyPoints)
    .sort((a, b) => a.index - b.index)
    .map((s) => truncate(stripCitations(s.sentence), 200));

  const detailPicks = byScore
    .slice(0, counts.detailSentences)
    .sort((a, b) => a.index - b.index)
    .map((s) => stripCitations(s.sentence));

  return {
    tldr,
    keyPoints: pointPicks,
    detailedSummary: detailPicks.join(' '),
    topics: topTopics(freq, 6),
    tone: 'Informative',
  };
}

// Keyless Q&A: sentences that share keywords with the question. If
// nothing overlaps, the answer is "not covered" — same rule as the
// LLM path, no guessing.
export function extractiveAnswer(text, question) {
  const terms = [...new Set(contentWords(question))];
  const sentences = splitSentences(text);
  if (!terms.length || !sentences.length) {
    return { covered: false, answer: "This page doesn't cover that — I couldn't find anything in the text that answers your question." };
  }
  // One shared word (often just a surname in a citation) isn't proof the
  // page answers anything — longer questions need at least two matches.
  const minHits = terms.length >= 3 ? 2 : 1;
  const matches = sentences
    .filter((s) => !isJunkSentence(s))
    .map((sentence) => {
      const lower = sentence.toLowerCase();
      const hits = terms.filter((t) => lower.includes(t)).length;
      return { sentence, hits };
    })
    .filter((m) => m.hits >= minHits)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3);

  if (!matches.length) {
    return { covered: false, answer: "This page doesn't cover that — nothing in the extracted text mentions the terms in your question." };
  }
  return { covered: true, answer: matches.map((m) => stripCitations(m.sentence)).join(' ') };
}
