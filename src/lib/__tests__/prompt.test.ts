import { describe, expect, it } from "vitest";
import { buildMessages, cleanReply } from "../prompt";
import { parseLog } from "../parse";

describe("buildMessages", () => {
  it("frames fixes as what works now and ends with the commit", () => {
    const [commit] = parseLog(
      "fix(ui): dark mode toggle not persisting",
    ).commits;
    const messages = buildMessages(commit);
    expect(messages[0].content).toContain("now FIXED");
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "Developer note: Dark mode toggle not persisting",
    });
  });
});

describe("cleanReply", () => {
  it("keeps the first line and trims quotes and periods", () => {
    expect(cleanReply('"export reports as CSV files."\nextra')).toBe(
      "Export reports as CSV files",
    );
  });
  it("rejects empty, echoed or rambling replies", () => {
    expect(cleanReply("")).toBeNull();
    expect(cleanReply("Developer note: add search")).toBeNull();
    expect(cleanReply("ok")).toBeNull();
    expect(cleanReply(Array(30).fill("word").join(" "))).toBeNull();
    expect(cleanReply("I'm ready for a request to build")).toBeNull();
    expect(cleanReply("Pre\u61c2 export in all forms")).toBeNull();
  });
  it("rejects lines that share no words with the commit", () => {
    expect(
      cleanReply("You're a great addition", "dark mode toggle not persisting"),
    ).toBeNull();
    expect(cleanReply("Charts look nicer now", "lazy load images")).toBeNull();
    expect(cleanReply("Images load as you scroll", "lazy load images")).toBe(
      "Images load as you scroll",
    );
  });
  it("rejects echoes of the commit", () => {
    expect(
      cleanReply(
        "Crash when uploading files larger than 10MB",
        "Crash when uploading files larger than 10mb",
      ),
    ).toBeNull();
  });
  it("never lets a dash through", () => {
    expect(cleanReply("Faster uploads \u2014 even on slow networks")).toBe(
      "Faster uploads, even on slow networks",
    );
  });
});
