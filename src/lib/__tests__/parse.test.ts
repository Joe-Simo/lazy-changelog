import { describe, expect, it } from "vitest";
import { extractSubjects, parseLog, toMarkdown } from "../parse";
import { EXAMPLE_LOG } from "../example";

describe("extractSubjects", () => {
  it("reads git log --oneline", () => {
    const out = extractSubjects(
      "a1b2c3d feat: add login\n\ne4f5a6b fix: crash on save",
    );
    expect(out.map((o) => o.hash)).toEqual(["a1b2c3d", "e4f5a6b"]);
    expect(out[1].text).toBe("fix: crash on save");
  });

  it("reads full git log with bodies", () => {
    const log = [
      "commit 0123456789abcdef0123456789abcdef01234567",
      "Author: Ada <ada@example.com>",
      "Date:   Mon Oct 19 10:00:00 2026 -0700",
      "",
      "    feat(api)!: drop v1 endpoints",
      "",
      "    BREAKING CHANGE: v1 is gone",
      "",
      "commit 89abcdef0123456789abcdef0123456789abcdef",
      "Author: Ada <ada@example.com>",
      "Date:   Sun Oct 18 10:00:00 2026 -0700",
      "",
      "    docs: fix readme link",
    ].join("\n");
    const out = extractSubjects(log);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      hash: "0123456",
      text: "feat(api)!: drop v1 endpoints",
    });
    expect(out[0].body).toContain("BREAKING CHANGE: v1 is gone");
  });

  it("reads --graph decorations and plain lines", () => {
    const out = extractSubjects(
      "* 1234567 (HEAD -> main, tag: v1.0.0) add search\n|\n- plain subject",
    );
    expect(out.map((o) => o.text)).toEqual(["add search", "plain subject"]);
  });
});

describe("parseLog", () => {
  it("strips conventional prefixes, scopes and PR numbers", () => {
    const { commits } = parseLog(
      "abc1234 feat(reports): export reports as CSV (#212)",
    );
    expect(commits[0]).toMatchObject({
      subject: "Export reports as CSV",
      scope: "reports",
      pr: "212",
      kind: "feature",
    });
  });

  it("leaves out merges, version bumps, wip and duplicates", () => {
    const { commits, skipped } = parseLog(
      [
        "Merge pull request #1 from a/b",
        "Merge branch 'main' into dev",
        "v2.3.0",
        "Bump version to 2.4.0",
        "wip",
        "fixup! fix: thing",
        "fix: thing",
        "fix: Thing.",
      ].join("\n"),
    );
    expect(commits.map((c) => c.subject)).toEqual(["Thing"]);
    expect(skipped).toHaveLength(7);
  });

  it("guesses a kind when there is no prefix", () => {
    const kinds = parseLog(
      [
        "Fix crash when saving",
        "Make search faster with a cache",
        "Add keyboard shortcuts",
        "Update README",
        "Refactor upload code",
      ].join("\n"),
    ).commits.map((c) => c.kind);
    expect(kinds).toEqual(["fix", "perf", "feature", "docs", "internal"]);
  });

  it("flags breaking changes", () => {
    const { commits } = parseLog("feat(api)!: drop v1 endpoints");
    expect(commits[0].breaking).toBe(true);
  });

  it("returns nothing for empty input", () => {
    expect(parseLog("   \n  ")).toEqual({ commits: [], skipped: [] });
  });

  it("handles the built in example", () => {
    const { commits, skipped } = parseLog(EXAMPLE_LOG);
    expect(skipped).toEqual([
      "Merge pull request #212 from mira/csv-export",
      "wip",
      "v2.3.0",
    ]);
    expect(commits.filter((c) => c.kind === "fix")).toHaveLength(3);
  });
});

describe("toMarkdown", () => {
  it("groups lines, hides internal work by default and keeps PR links", () => {
    const { commits } = parseLog(
      "feat: add search (#3)\nfix: crash on save\nchore: bump deps",
    );
    const md = toMarkdown(commits, { [commits[0].id]: "Search your notes" });
    expect(md).toBe(
      "### New\n\n- Search your notes (#3)\n\n### Fixed\n\n- Crash on save\n",
    );
    expect(toMarkdown(commits, {}, { includeInternal: true })).toContain(
      "### Behind the scenes",
    );
  });

  it("puts breaking changes first", () => {
    const { commits } = parseLog(
      "feat: add search\nfeat!: remove legacy export",
    );
    expect(
      toMarkdown(commits, {}).startsWith(
        "### Heads up\n\n- Remove legacy export",
      ),
    ).toBe(true);
  });
});
