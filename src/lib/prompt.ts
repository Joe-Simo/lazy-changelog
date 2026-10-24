import type { Commit } from "./parse";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type Rewritable = "feature" | "fix" | "perf";

const RULES =
  "Keep the meaning exactly. Plain words, under 14 words, no period at the end. Reply with the line only.";

const SYSTEM: Record<Rewritable, string> = {
  feature: `Rewrite the developer note as one line of release notes that tells a user what they can now do. ${RULES}`,
  fix: `The developer note names a bug that is now FIXED. Write one line of release notes that tells a user what works correctly now. ${RULES}`,
  perf: `The developer note names a speed improvement. Write one line of release notes that tells a user what got faster. ${RULES}`,
};

const EXAMPLES: Record<Rewritable, [string, string][]> = {
  feature: [
    [
      "add pagination to projects endpoint",
      "Browse long project lists page by page",
    ],
    ["add dark theme", "Use the app in a dark theme"],
    ["allow users to rename folders", "Rename your folders"],
  ],
  fix: [
    [
      "login button unresponsive on safari",
      "The login button works on Safari again",
    ],
    [
      "wrong total when cart has discounts",
      "Cart totals are correct when a discount is applied",
    ],
    [
      "crash when opening empty project",
      "Opening an empty project no longer crashes the app",
    ],
  ],
  perf: [
    ["memoize chart rendering", "Charts draw faster"],
    [
      "cache api responses for 60s",
      "Pages load faster thanks to short caching",
    ],
    ["debounce search input", "Search feels quicker while you type"],
  ],
};

export function buildMessages(commit: Commit): ChatMessage[] {
  const kind = (
    commit.kind === "fix" || commit.kind === "perf" ? commit.kind : "feature"
  ) as Rewritable;
  const note = commit.subject;
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM[kind] }];
  for (const [input, output] of EXAMPLES[kind]) {
    messages.push(
      { role: "user", content: `Developer note: ${input}` },
      { role: "assistant", content: output },
    );
  }
  messages.push({ role: "user", content: `Developer note: ${note}` });
  return messages;
}

/**
 * Tidy one model reply. Returns null when the reply is not a usable line,
 * so the caller keeps the original subject instead of showing junk.
 */
export function cleanReply(reply: string, source?: string): string | null {
  let line =
    reply
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  line = line
    .replace(/^(release note|line|answer|output)s?:\s*/i, "")
    .replace(/^[-*"'`\s]+|["'`\s]+$/g, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ");
  if (!line) return null;
  if (/developer note/i.test(line)) return null;
  // Release notes are plain English here; stray scripts or chatter mean the model went off the rails.
  if (/[^\x20-\x7e]/.test(line)) return null;
  if (/^(i|i'm|i am|you're|sure|here|please|sorry)\b/i.test(line)) return null;
  if (source && !sharesWord(line, source)) return null;
  // An echo of the commit adds nothing, and for a fix it would read as if the bug were still there.
  if (source && squash(line) === squash(source.replace(/\s*\(#\d+\)$/, "")))
    return null;
  const words = line.split(/\s+/).length;
  if (words < 2 || words > 22) return null;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

const stem = (w: string) => w.toLowerCase().slice(0, 4);

/** True when the reply keeps at least one real word from the commit, a cheap guard against made-up lines. */
function sharesWord(line: string, source: string): boolean {
  const words = (text: string) => text.match(/[a-z0-9]{4,}/gi) ?? [];
  const wanted = new Set(words(source).map(stem));
  return words(line).some((w) => wanted.has(stem(w)));
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
