/**
 * Lightweight lexical reranking and excerpt selection.
 *
 * Why this exists: pure vector search has two failure modes that show up
 * directly in the citations panel.
 *
 *   1. It returns whatever clears the similarity floor, so an answer can end
 *      up citing passages from four files when two were relevant. The reader
 *      cannot tell which document actually supported the answer.
 *   2. It returns whole chunks. A chunk is ~1000 characters of raw document,
 *      so a citation is a wall of text — including headings, tables and code
 *      fences belonging to sections the question never asked about.
 *
 * Neither is fixable by lowering a threshold. What helps is a second, cheap
 * signal: pure token overlap between the question and the passage. Embeddings
 * capture paraphrase; lexical overlap catches the literal terms, and the two
 * fail in different directions, so combining them is more reliable than either.
 *
 * This is deliberately NOT a cross-encoder reranker. Those are more accurate,
 * but they need a second model, add a network round trip, and cost latency on
 * every query. For a corpus of this size the hybrid signal is enough, and it
 * runs in microseconds with no new dependencies.
 */

/**
 * Function words carry no retrieval signal but inflate the token count, so a
 * question like "what are the breaking changes" would otherwise score highly
 * against any passage containing "the".
 */
const STOPWORDS = new Set([
  "a",
  "about",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "might",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Lowercase, split on anything non-alphanumeric, drop noise. */
export function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Fraction of the query's distinct terms that appear in the text.
 *
 * Distinct terms rather than raw counts, so a passage that repeats one word
 * twenty times cannot fake relevance. Returns 0 for an empty query.
 */
export function lexicalCoverage(
  queryTokens: ReadonlySet<string>,
  text: string,
): number {
  if (queryTokens.size === 0) return 0;

  const textTokens = new Set(tokenize(text));
  if (textTokens.size === 0) return 0;

  let hits = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) hits++;
  }

  return hits / queryTokens.size;
}

/**
 * Splits text into readable units: sentences within a line, lines within a
 * block. Chunks are markdown, so splitting on newlines first keeps a heading
 * from being glued to the paragraph beneath it.
 *
 * The sentence split uses a sentinel rather than a lookbehind so it does not
 * depend on the regex engine's lookbehind support.
 */
function splitUnits(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+|\s*\|\s*/))
    .map((unit) => unit.replace(/^[#>*\-\s]+/, "").trim())
    .filter((unit) => unit.length > 0);
}

/** Hard cut at `maxChars`, on a word boundary where one is available. */
function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const clipped = text.slice(0, maxChars);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only respect the word boundary if it is not so early that the result
  // would be mostly whitespace trimmed away.
  const base =
    lastSpace > maxChars * 0.6 ? clipped.slice(0, lastSpace) : clipped;

  return base.replace(/[\s,;:.!?-]+$/, "");
}

/**
 * Picks the most relevant contiguous window of the passage.
 *
 * Contiguity matters: taking the single best sentence often yields a fragment
 * that means nothing out of context ("which roughly triples the runtime."), so
 * neighbouring units are carried along until the character budget is spent.
 * That keeps the excerpt readable prose while still centring on the match.
 */
export function selectExcerpt(
  query: string,
  text: string,
  maxChars: number,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const units = splitUnits(trimmed);
  if (units.length === 0) return `${truncateChars(trimmed, maxChars)}…`;

  const queryTokens = new Set(tokenize(query));
  const scores = units.map((unit) => lexicalCoverage(queryTokens, unit));

  let best = { start: 0, end: 1, score: Number.NEGATIVE_INFINITY };

  for (let start = 0; start < units.length; start++) {
    let chars = 0;
    let score = 0;

    for (let end = start; end < units.length; end++) {
      const length = units[end]?.length ?? 0;
      // Always take at least one unit, even if it is oversized, otherwise a
      // single very long sentence would produce an empty excerpt.
      if (chars + length > maxChars && end > start) break;

      chars += length;
      score += scores[end] ?? 0;

      if (score > best.score) best = { start, end: end + 1, score };
    }
  }

  const slice = units.slice(best.start, best.end).join(" ").trim();
  const prefix = best.start > 0 ? "… " : "";
  const suffix = best.end < units.length ? " …" : "";

  return `${prefix}${truncateChars(slice, maxChars)}${suffix}`;
}

/**
 * Key for detecting two chunks that are effectively the same text.
 *
 * Chunks are cut with overlap, so a sentence near a boundary is stored twice.
 * Without this, overlapping duplicates occupy citation slots and inflate the
 * "N passages" count with what is really one piece of evidence.
 */
export function duplicateKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 140);
}
