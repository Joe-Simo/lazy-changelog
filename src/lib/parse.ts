export type Kind = "feature" | "fix" | "perf" | "docs" | "internal";

export interface Commit {
  /** Stable id for React keys and model jobs. */
  id: string;
  /** Short hash when the log had one. */
  hash?: string;
  /** The subject line exactly as written. */
  raw: string;
  /** Subject with conventional prefix, scope and PR suffix removed. */
  subject: string;
  scope?: string;
  /** Pull request number, from "(#123)" or "Merge pull request #123". */
  pr?: string;
  kind: Kind;
  breaking: boolean;
}

export interface ParseResult {
  commits: Commit[];
  /** Lines we dropped on purpose: merges, version bumps, work in progress, reverts of reverts. */
  skipped: string[];
}

const PREFIX: Record<string, Kind> = {
  feat: "feature",
  feature: "feature",
  add: "feature",
  fix: "fix",
  bugfix: "fix",
  hotfix: "fix",
  perf: "perf",
  docs: "docs",
  doc: "docs",
  refactor: "internal",
  chore: "internal",
  test: "internal",
  tests: "internal",
  ci: "internal",
  build: "internal",
  style: "internal",
  deps: "internal",
  revert: "internal",
};

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
const HASH_LINE = /^(?:\*\s+)?([0-9a-f]{7,40})\s+(?:\([^)]*\)\s+)?(.+)$/i;
const NOISE = [
  /^merge (branch|remote-tracking branch|tag)\b/i,
  /^merge pull request\b/i,
  /^merged? in\b/i,
  /^v?\d+\.\d+\.\d+(?:[-+.\w]*)?$/i,
  /^(bump|release|prepare release)\s+(version\s+)?(to\s+)?v?\d+\.\d+/i,
  /^chore\(release\)/i,
  /^wip\b/i,
  /^(fixup|squash)!/i,
  /^initial commit$/i,
];

function guessKind(subject: string): Kind {
  const s = subject.toLowerCase();
  if (
    /\b(fix(es|ed)?|bug|crash|broken|resolve[sd]?|patch|prevent|regression|handle)\b/.test(
      s,
    )
  )
    return "fix";
  if (
    /\b(faster|speed( up)?|perf(ormance)?|optimi[sz]e[sd]?|cache[sd]?|lazy[- ]load|memoi[sz]e)\b/.test(
      s,
    )
  )
    return "perf";
  if (/\b(readme|docs?|documentation|typo in (the )?docs)\b/.test(s))
    return "docs";
  if (
    /\b(refactor|cleanup|clean up|lint|format|rename|bump|upgrade|deps?|dependenc(y|ies)|ci|tests?)\b/.test(
      s,
    )
  )
    return "internal";
  if (
    /\b(add(s|ed)?|new|support(s)?|allow(s)?|introduce[sd]?|enable[sd]?|implement(s|ed)?|show|let)\b/.test(
      s,
    )
  )
    return "feature";
  return "feature";
}

function tidy(s: string): string {
  const t = s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pull every commit subject out of `git log`, `git log --oneline`, or one subject per line. */
export function extractSubjects(
  log: string,
): { hash?: string; text: string; body: string[] }[] {
  const lines = log.replace(/\r\n?/g, "\n").split("\n");
  const out: { hash?: string; text: string; body: string[] }[] = [];
  const isFull = lines.some((l) => /^commit [0-9a-f]{7,40}\b/.test(l));

  if (isFull) {
    let current: { hash?: string; text: string; body: string[] } | null = null;
    for (const line of lines) {
      const head = line.match(/^commit ([0-9a-f]{7,40})\b/);
      if (head) {
        current = { hash: head[1].slice(0, 7), text: "", body: [] };
        out.push(current);
        continue;
      }
      if (
        !current ||
        /^(Author|Date|Merge|Commit|AuthorDate|CommitDate):/.test(line)
      )
        continue;
      const msg = line.replace(/^ {4}/, "");
      if (!msg.trim()) continue;
      if (!current.text) current.text = msg.trim();
      else current.body.push(msg.trim());
    }
    return out.filter((c) => c.text);
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[|\\/*\s]+$/.test(trimmed)) continue;
    const m = trimmed.match(HASH_LINE);
    if (m) out.push({ hash: m[1].slice(0, 7), text: m[2].trim(), body: [] });
    else out.push({ text: trimmed.replace(/^[-*]\s+/, ""), body: [] });
  }
  return out;
}

export function parseLog(log: string): ParseResult {
  const commits: Commit[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  extractSubjects(log).forEach((entry, i) => {
    const raw = entry.text;
    if (NOISE.some((r) => r.test(raw))) {
      skipped.push(raw);
      return;
    }

    let text = raw;
    let pr: string | undefined;
    const prMatch = text.match(/\s*\(#(\d+)\)\s*$/);
    if (prMatch) {
      pr = prMatch[1];
      text = text.slice(0, prMatch.index).trim();
    }

    let kind: Kind | undefined;
    let scope: string | undefined;
    let breaking = entry.body.some((b) => /^BREAKING[ -]CHANGE:/.test(b));
    const conv = text.match(CONVENTIONAL);
    if (conv && PREFIX[conv[1].toLowerCase()]) {
      kind = PREFIX[conv[1].toLowerCase()];
      scope = conv[2]?.trim() || undefined;
      breaking = breaking || conv[3] === "!";
      text = conv[4];
    }
    // Gitmoji and bracket tags like "[api]" carry no meaning for users.
    text = text.replace(/^(:\w+:\s*)+/, "").replace(/^\[[^\]]+\]\s*/, "");

    const subject = tidy(text);
    if (!subject) {
      skipped.push(raw);
      return;
    }
    const key = subject.toLowerCase();
    if (seen.has(key)) {
      skipped.push(raw);
      return;
    }
    seen.add(key);

    commits.push({
      id: `${i}-${entry.hash ?? key.slice(0, 24)}`,
      hash: entry.hash,
      raw,
      subject,
      scope,
      pr,
      kind: kind ?? guessKind(subject),
      breaking,
    });
  });

  return { commits, skipped };
}

export const SECTIONS: { kind: Kind; title: string }[] = [
  { kind: "feature", title: "New" },
  { kind: "fix", title: "Fixed" },
  { kind: "perf", title: "Faster" },
  { kind: "docs", title: "Docs" },
  { kind: "internal", title: "Behind the scenes" },
];

/** Kinds worth sending to the model. Internal and docs lines stay as written. */
export function needsRewrite(kind: Kind): boolean {
  return kind === "feature" || kind === "fix" || kind === "perf";
}

export function toMarkdown(
  commits: Commit[],
  lines: Record<string, string>,
  opts: { title?: string; includeInternal?: boolean } = {},
): string {
  const parts: string[] = [];
  if (opts.title?.trim()) parts.push(`## ${opts.title.trim()}`, "");
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) {
    parts.push("### Heads up", "");
    for (const c of breaking)
      parts.push(`- ${lines[c.id] ?? c.subject}${c.pr ? ` (#${c.pr})` : ""}`);
    parts.push("");
  }
  for (const { kind, title } of SECTIONS) {
    if (kind === "internal" && !opts.includeInternal) continue;
    const group = commits.filter((c) => c.kind === kind && !c.breaking);
    if (!group.length) continue;
    parts.push(`### ${title}`, "");
    for (const c of group)
      parts.push(`- ${lines[c.id] ?? c.subject}${c.pr ? ` (#${c.pr})` : ""}`);
    parts.push("");
  }
  return parts.join("\n").trim() + "\n";
}
