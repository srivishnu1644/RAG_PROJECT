import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { Check, Copy } from "lucide-react";

/**
 * A small, dependency-free markdown renderer scoped to what a chat model
 * actually emits: headings, paragraphs, lists, tables, blockquotes, rules,
 * links, and fenced code.
 *
 * Written by hand rather than pulled from npm because (a) the streaming path
 * re-parses on every token, so the parser has to be cheap and allocation-light,
 * and (b) the output is untrusted model text — every branch below emits
 * React elements, never `dangerouslySetInnerHTML`, so a chunk of injected
 * markup renders as literal characters instead of executing.
 */

/* ── Inline ─────────────────────────────────────────────────────────── */

/**
 * Splits on inline markers, keeping the delimiters in the match so each span
 * can be classified. Order matters: code is matched first so that
 * `**bold**` inside a code span is not treated as emphasis.
 */
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  INLINE_RE.lastIndex = 0;

  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;

    if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      out.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        const label = linkMatch[1] ?? "";
        const href = linkMatch[2] ?? "";
        // Only http(s) and mailto are followed; anything else (javascript:,
        // data:) renders as plain text so model output can't inject a
        // clickable script URL.
        const safe = /^(https?:|mailto:)/i.test(href);
        out.push(
          safe ? (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {label}
            </a>
          ) : (
            <span key={key}>{label}</span>
          ),
        );
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) out.push(text.slice(lastIndex));

  return out;
}

/* ── Code block ─────────────────────────────────────────────────────── */

interface CodeBlockProps {
  code: string;
  language: string;
}

const LABEL: Record<string, string> = {
  js: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  tsx: "TSX",
  py: "Python",
  rb: "Ruby",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  sql: "SQL",
  md: "Markdown",
  html: "HTML",
  css: "CSS",
  mjs: "JavaScript",
  cs: "C#",
  java: "Java",
  go: "Go",
  rs: "Rust",
  php: "PHP",
};

/**
 * Dark "product chrome" code block with a language badge and a copy button.
 * The badge sits on the block's top edge rather than in a separate header so
 * the code itself keeps the full width.
 */
function CodeBlock({ code, language }: CodeBlockProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(() => {
    const done = (): void => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    };

    // navigator.clipboard needs a secure context; the insecure path is a
    // no-op selection so the button never lies about having copied.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).then(done, () => undefined);
      return;
    }
    done();
  }, [code]);

  const badge =
    LABEL[language.toLowerCase()] ?? (language || "code").toUpperCase();

  return (
    <div className="surface-dark group relative overflow-hidden rounded-lg border border-surface-dark-elevated">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 px-3.5 py-2">
        <span className="label-caps font-mono text-on-dark-soft">{badge}</span>

        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied to clipboard" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-caption text-on-dark-soft transition-colors hover:bg-white/8 hover:text-on-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {copied ? (
            <>
              <Check className="size-3" aria-hidden />
              <span className="font-medium">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" aria-hidden />
              <span className="font-medium">Copy</span>
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto px-3.5 py-3 text-small leading-[1.65] text-on-dark">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

/* ── Block parser ───────────────────────────────────────────────────── */

type Block =
  | { kind: "code"; code: string; language: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const FENCE_RE = /^```\s*([A-Za-z0-9+#.-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/** True when a line looks like a table's `| --- | --- |` separator row. */
function isTableDivider(line: string | undefined): boolean {
  if (!line) return false;
  return /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  /*
   * Every read goes through this accessor. The project runs with
   * noUncheckedIndexedAccess, so direct indexing yields `string | undefined`;
   * routing through `at()` turns out-of-range reads into "" and keeps the
   * regex branches below free of null checks.
   */
  const at = (index: number): string => lines[index] ?? "";

  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = at(i);

    // Fenced code: consume until the closing fence or end of input. An
    // unterminated fence is normal mid-stream, so it still renders.
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(at(i))) {
        body.push(at(i));
        i++;
      }
      blocks.push({ kind: "code", code: body.join("\n"), language });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE_RE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        text: (heading[2] ?? "").trim(),
      });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushParagraph();
      const body: string[] = [quote[1] ?? ""];
      while (i + 1 < lines.length && QUOTE_RE.test(at(i + 1))) {
        i++;
        body.push(QUOTE_RE.exec(at(i))?.[1] ?? "");
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    // Table: a pipe row followed by a divider row. The header consumes the
    // divider; body rows run until a line without a pipe.
    if (line.includes("|") && isTableDivider(at(i + 1))) {
      flushParagraph();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes("|") && at(i).trim() !== "") {
        rows.push(splitRow(at(i)));
        i++;
      }
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const ul = UL_RE.exec(line);
    if (ul) {
      flushParagraph();
      const items: string[] = [ul[1] ?? ""];
      while (i + 1 < lines.length) {
        const next = UL_RE.exec(at(i + 1));
        if (!next) break;
        items.push(next[1] ?? "");
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    const ol = OL_RE.exec(line);
    if (ol) {
      flushParagraph();
      const items: string[] = [ol[1] ?? ""];
      while (i + 1 < lines.length) {
        const next = OL_RE.exec(at(i + 1));
        if (!next) break;
        items.push(next[1] ?? "");
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/* ── Component ──────────────────────────────────────────────────────── */

interface MarkdownProps {
  content: string;
  /**
   * "dense" reuses the same grammar one step tighter, for a retrieved
   * passage quoted inside a citation. Without it a citation has to invent its
   * own formatting and drifts from the answer's typography.
   */
  density?: "default" | "dense" | "quiet";
}

export function Markdown({
  content,
  density = "default",
}: MarkdownProps): ReactNode {
  const blocks = parse(content);

  const className =
    density === "dense"
      ? "md md-dense"
      : density === "quiet"
        ? "md md-quiet"
        : "md";

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;

        switch (block.kind) {
          case "code":
            return (
              <CodeBlock
                key={key}
                code={block.code}
                language={block.language}
              />
            );

          case "heading": {
            const Tag = `h${Math.min(block.level, 6)}` as "h1";
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }

          case "quote":
            return (
              <blockquote key={key}>{renderInline(block.text, key)}</blockquote>
            );

          case "rule":
            return <hr key={key} />;

          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </li>
                ))}
              </Tag>
            );
          }

          case "table":
            return (
              <div key={key} className="md-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, cellIndex) => (
                        <th key={`${key}-h${cellIndex}`}>
                          {renderInline(cell, `${key}-h${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={`${key}-r${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${key}-r${rowIndex}c${cellIndex}`}>
                            {renderInline(
                              cell,
                              `${key}-r${rowIndex}c${cellIndex}`,
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}

/**
 * Streaming caret. Rendered after the prose block so it sits on the last
 * line rather than on its own, and given `inline-block` + fixed height so
 * it cannot change line box metrics as text grows.
 */
export function StreamingCaret(): ReactNode {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 0.15, 1] }}
      transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      className="ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-[0.18em] rounded-pill bg-primary align-baseline"
    />
  );
}
