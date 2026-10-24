"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseLog,
  SECTIONS,
  needsRewrite,
  toMarkdown,
  type Commit,
} from "@/lib/parse";
import { buildMessages, cleanReply } from "@/lib/prompt";
import {
  BACKENDS,
  MODEL_NAME,
  detectBackend,
  type Backend,
  type WorkerResponse,
} from "@/lib/model";
import { EXAMPLE_LOG, GIT_COMMAND } from "@/lib/example";

type LineState = { text: string; source: "gemma" | "kept" };
type RunState = {
  log: string | null;
  lines: Record<string, LineState>;
  done: boolean;
};
type ModelState =
  | { status: "idle" }
  | { status: "downloading"; loaded: number; total: number }
  | { status: "ready" }
  | { status: "error"; message: string };

const CACHED_KEY = "lazy-changelog:model-cached";
const REPO_URL = "https://github.com/Joe-Simo/lazy-changelog";

export default function LazyChangelog() {
  const [log, setLog] = useState("");
  const [backend, setBackend] = useState<Backend | null>(null);
  const [model, setModel] = useState<ModelState>({ status: "idle" });
  const [run, setRun] = useState<RunState>({
    log: null,
    lines: {},
    done: false,
  });
  const [showSource, setShowSource] = useState(false);
  const [includeInternal, setIncludeInternal] = useState(false);
  const [copied, setCopied] = useState<"notes" | "command" | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const runRef = useRef(0);
  const jobsRef = useRef<Map<string, string>>(new Map());

  const parsed = useMemo(() => parseLog(log), [log]);
  const { commits, skipped } = parsed;
  const rewritable = useMemo(
    () => commits.filter((c) => needsRewrite(c.kind)),
    [commits],
  );

  // Results only count for the log they were made from.
  const current = run.log === log;
  const lines = useMemo(() => (current ? run.lines : {}), [current, run.lines]);
  const busy =
    model.status === "ready" && rewritable.length > 0 && !(current && run.done);
  const doneCount = rewritable.filter((c) => lines[c.id]).length;

  const display = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of commits) out[c.id] = lines[c.id]?.text ?? c.subject;
    return out;
  }, [commits, lines]);

  const markdown = useMemo(
    () =>
      commits.length ? toMarkdown(commits, display, { includeInternal }) : "",
    [commits, display, includeInternal],
  );

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = new Worker(new URL("../lib/worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress")
        setModel({
          status: "downloading",
          loaded: msg.loaded,
          total: msg.total,
        });
      else if (msg.type === "ready") {
        localStorage.setItem(CACHED_KEY, "1");
        setModel({ status: "ready" });
      } else if (msg.type === "line") {
        if (msg.runId !== runRef.current) return;
        const raw = jobsRef.current.get(msg.id) ?? "";
        const cleaned = cleanReply(msg.text, raw);
        const line: LineState = cleaned
          ? { text: cleaned, source: "gemma" }
          : { text: raw, source: "kept" };
        setRun((prev) => ({
          ...prev,
          lines: { ...prev.lines, [msg.id]: line },
        }));
      } else if (msg.type === "done") {
        if (msg.runId === runRef.current)
          setRun((prev) => ({ ...prev, done: true }));
      } else if (msg.type === "error") {
        setModel({ status: "error", message: msg.message });
      }
    };
    worker.onerror = (e) =>
      setModel({
        status: "error",
        message: e.message || "The model worker stopped",
      });
    workerRef.current = worker;
    return worker;
  }, []);

  const loadModel = useCallback(
    (target: Backend | null = backend) => {
      if (!target) return;
      setModel({ status: "downloading", loaded: 0, total: 0 });
      getWorker().postMessage({ type: "load", backend: target });
    },
    [backend, getWorker],
  );

  useEffect(() => {
    let alive = true;
    detectBackend().then((b) => {
      if (!alive) return;
      setBackend(b);
      // Once the weights are in this browser's cache, loading costs nothing, so do it without asking.
      if (localStorage.getItem(CACHED_KEY) === "1") loadModel(b);
    });
    return () => {
      alive = false;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The lazy part: once the model is ready, it polishes whatever you paste after a short pause.
  useEffect(() => {
    if (model.status !== "ready") return;
    workerRef.current?.postMessage({ type: "cancel", runId: runRef.current });
    const t = setTimeout(() => {
      const runId = ++runRef.current;
      jobsRef.current = new Map(rewritable.map((c) => [c.id, c.subject]));
      setRun({ log, lines: {}, done: rewritable.length === 0 });
      if (!rewritable.length) return;
      getWorker().postMessage({
        type: "rewrite",
        runId,
        jobs: rewritable.map((c) => ({ id: c.id, messages: buildMessages(c) })),
      });
    }, 500);
    return () => clearTimeout(t);
  }, [log, rewritable, model.status, getWorker]);

  const copy = async (what: "notes" | "command") => {
    await navigator.clipboard.writeText(
      what === "notes" ? markdown : GIT_COMMAND,
    );
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const hasInput = log.trim().length > 0;
  const progress =
    model.status === "downloading" && model.total > 0
      ? Math.min(1, model.loaded / model.total)
      : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Lazy Changelog
        </h1>
        <p className="mt-3 text-lg text-muted">
          Paste your git log. Get release notes people can read. {MODEL_NAME}{" "}
          does the rewriting inside this tab, so your commits never leave your
          machine.
        </p>
      </header>

      <main className="grid flex-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="input-title" className="flex flex-col">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="input-title" className="text-sm font-medium">
              Git log
            </h2>
            <div className="flex gap-2">
              {hasInput ? (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setLog("")}
                >
                  Clear
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setLog(EXAMPLE_LOG)}
                >
                  Try an example
                </button>
              )}
            </div>
          </div>
          <textarea
            value={log}
            onChange={(e) => setLog(e.target.value)}
            spellCheck={false}
            placeholder={
              "7d02e1b feat(reports): export reports as CSV (#212)\nc4e88a0 fix: crash when uploading large files\n..."
            }
            aria-label="Paste your git log"
            className="panel min-h-72 flex-1 resize-none p-4 font-mono text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:min-h-[28rem]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>Get it with</span>
            <button
              type="button"
              onClick={() => copy("command")}
              className="rounded-md bg-sunken px-2 py-1 font-mono text-[12px] text-foreground hover:bg-sunken/70"
              title="Copy command"
            >
              {GIT_COMMAND}
            </button>
            <span aria-live="polite" className="text-accent">
              {copied === "command" ? "Copied" : ""}
            </span>
          </div>
        </section>

        <section aria-labelledby="output-title" className="flex flex-col">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="output-title" className="text-sm font-medium">
              Release notes
            </h2>
            <button
              type="button"
              className="btn-primary"
              disabled={!commits.length}
              onClick={() => copy("notes")}
            >
              {copied === "notes" ? "Copied" : "Copy Markdown"}
            </button>
          </div>

          <div className="panel flex min-h-72 flex-1 flex-col p-5 lg:min-h-[28rem]">
            <ModelBar
              model={model}
              backend={backend}
              progress={progress}
              busy={busy}
              done={doneCount}
              total={rewritable.length}
              onLoad={() => loadModel()}
              hasCommits={commits.length > 0}
            />

            {!hasInput ? (
              <Empty title="Nothing to read yet">
                Paste the output of{" "}
                <code className="font-mono text-[12px]">git log</code> on the
                left, or try the example. A draft shows up the moment you paste.
              </Empty>
            ) : !commits.length ? (
              <Empty title="No commits found">
                That text did not look like a git log. Paste one commit per
                line, the output of{" "}
                <code className="font-mono text-[12px]">git log --oneline</code>
                , or plain{" "}
                <code className="font-mono text-[12px]">git log</code>.
              </Empty>
            ) : (
              <Notes
                commits={commits}
                lines={lines}
                busy={busy}
                showSource={showSource}
                includeInternal={includeInternal}
              />
            )}

            {commits.length > 0 && (
              <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-muted">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showSource}
                    onChange={(e) => setShowSource(e.target.checked)}
                  />
                  Show commits
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeInternal}
                    onChange={(e) => setIncludeInternal(e.target.checked)}
                  />
                  Include behind the scenes
                </label>
                {skipped.length > 0 && (
                  <details className="w-full">
                    <summary className="cursor-pointer">
                      Left out {skipped.length}{" "}
                      {skipped.length === 1 ? "line" : "lines"} (merges, version
                      bumps, work in progress, duplicates)
                    </summary>
                    <ul className="mt-2 space-y-1 font-mono text-[12px]">
                      {skipped.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
        <span>
          Runs{" "}
          <a
            className="link"
            href="https://huggingface.co/onnx-community/gemma-3-1b-it-ONNX"
            target="_blank"
            rel="noreferrer"
          >
            {MODEL_NAME}
          </a>{" "}
          with{" "}
          <a
            className="link"
            href="https://github.com/huggingface/transformers.js"
            target="_blank"
            rel="noreferrer"
          >
            Transformers.js
          </a>
          . No server, no API key.
        </span>
        <a className="link" href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub (MIT)
        </a>
      </footer>
    </div>
  );
}

function ModelBar(props: {
  model: ModelState;
  backend: Backend | null;
  progress: number | null;
  busy: boolean;
  done: number;
  total: number;
  hasCommits: boolean;
  onLoad: () => void;
}) {
  const { model, backend, progress, busy, done, total, hasCommits, onLoad } =
    props;
  const cpuNote =
    backend === "wasm"
      ? " This browser has no WebGPU, so it runs on the CPU. It works, just slower."
      : "";

  let body: React.ReactNode;
  if (model.status === "idle") {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {hasCommits
            ? "This is a quick draft from your commit messages. "
            : ""}
          Let {MODEL_NAME} rewrite it in plain English. One download,{" "}
          {backend ? BACKENDS[backend].sizeLabel : "under 1 GB"}, then it stays
          cached.{cpuNote}
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={onLoad}
          disabled={!backend}
        >
          Load {MODEL_NAME}
        </button>
      </div>
    );
  } else if (model.status === "downloading") {
    body = (
      <div>
        <p className="text-sm text-muted">
          {progress === null
            ? `Starting ${MODEL_NAME}...`
            : progress < 1
              ? `Downloading ${MODEL_NAME}: ${Math.round(progress * 100)}%`
              : `Warming up ${MODEL_NAME}...`}
          {cpuNote}
        </p>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={Math.round((progress ?? 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${(progress ?? 0) * 100}%` }}
          />
        </div>
      </div>
    );
  } else if (model.status === "error") {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-danger" title={model.message}>
          {MODEL_NAME} could not start in this browser, so these lines are the
          plain draft. Your log is still safe in this tab.
        </p>
        <button type="button" className="btn-quiet" onClick={onLoad}>
          Try again
        </button>
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-muted" aria-live="polite">
        {!hasCommits || total === 0
          ? `${MODEL_NAME} is ready${backend === "wasm" ? " (CPU)" : ""}. Paste a log and it starts on its own.`
          : busy
            ? `${MODEL_NAME} is rewriting ${done + 1} of ${total}...`
            : `Rewritten by ${MODEL_NAME} in this tab. Check it, then copy.`}
      </p>
    );
  }
  return <div className="mb-5 border-b border-line pb-4">{body}</div>;
}

function Notes(props: {
  commits: Commit[];
  lines: Record<string, LineState>;
  busy: boolean;
  showSource: boolean;
  includeInternal: boolean;
}) {
  const { commits, lines, busy, showSource, includeInternal } = props;
  const breaking = commits.filter((c) => c.breaking);
  const groups = [
    ...(breaking.length
      ? [{ key: "breaking", title: "Heads up", items: breaking }]
      : []),
    ...SECTIONS.filter((s) => s.kind !== "internal" || includeInternal).map(
      (s) => ({
        key: s.kind,
        title: s.title,
        items: commits.filter((c) => c.kind === s.kind && !c.breaking),
      }),
    ),
  ].filter((g) => g.items.length);

  if (!groups.length) {
    return (
      <Empty title="Only housekeeping here">
        Every commit was internal work. Tick &ldquo;Include behind the
        scenes&rdquo; to list it anyway.
      </Empty>
    );
  }

  return (
    <div className="space-y-6 pb-5">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted">
            {g.title}
          </h3>
          <ul className="space-y-2.5">
            {g.items.map((c) => {
              const line = lines[c.id];
              const pending = busy && needsRewrite(c.kind) && !line;
              return (
                <li key={c.id} className="flex gap-3">
                  <span
                    aria-hidden
                    className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${line?.source === "gemma" ? "bg-accent" : "bg-line"}`}
                  />
                  <div className="min-w-0">
                    <p className={pending ? "text-muted" : ""}>
                      {line?.text ?? c.subject}
                      {c.pr && <span className="text-muted"> (#{c.pr})</span>}
                    </p>
                    {showSource && (
                      <p
                        className="mt-0.5 truncate font-mono text-[12px] text-muted"
                        title={c.raw}
                      >
                        {c.hash ? `${c.hash} ` : ""}
                        {c.raw}
                        {line?.source === "kept" ? " (kept as written)" : ""}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted">{children}</p>
    </div>
  );
}
