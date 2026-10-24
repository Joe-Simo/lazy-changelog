/// <reference lib="webworker" />
import {
  pipeline,
  type TextGenerationPipeline,
} from "@huggingface/transformers";
import {
  BACKENDS,
  MODEL_ID,
  type Backend,
  type WorkerRequest,
  type WorkerResponse,
} from "./model";

let generator: TextGenerationPipeline | null = null;
let loading: Promise<TextGenerationPipeline> | null = null;
let activeRun = 0;

const post = (msg: WorkerResponse) => self.postMessage(msg);

function load(backend: Backend) {
  if (generator) return Promise.resolve(generator);
  if (loading) return loading;
  const files = new Map<string, { loaded: number; total: number }>();
  const { device, dtype, externalData } = BACKENDS[backend];
  loading = (
    pipeline("text-generation", MODEL_ID, {
      device,
      dtype,
      // The model config expects split weights; the 8-bit file is a single blob.
      ...(externalData ? {} : { use_external_data_format: false }),
      progress_callback: (p: {
        status: string;
        file?: string;
        loaded?: number;
        total?: number;
      }) => {
        if (p.status !== "progress" || !p.file || !p.total) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: "progress", loaded, total });
      },
    }) as Promise<TextGenerationPipeline>
  ).then((g) => {
    generator = g;
    post({ type: "ready", backend });
    return g;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    if (msg.runId === activeRun) activeRun = -1;
    return;
  }
  if (msg.type === "load") {
    try {
      await load(msg.backend);
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
  if (msg.type === "rewrite") {
    activeRun = msg.runId;
    // One generation at a time: a new run waits for the current line to finish, then the old run stops.
    queue = queue.then(() => run(msg));
  }
};

let queue: Promise<void> = Promise.resolve();

async function run(msg: Extract<WorkerRequest, { type: "rewrite" }>) {
  if (activeRun !== msg.runId) return;
  try {
    if (!generator) throw new Error("The model is not loaded yet.");
    for (const job of msg.jobs) {
      if (activeRun !== msg.runId) return;
      const started = performance.now();
      const out = (await generator(job.messages as never, {
        max_new_tokens: 32,
        do_sample: false,
      })) as unknown as {
        generated_text: { role: string; content: string }[];
      }[];
      if (activeRun !== msg.runId) return;
      const text = out[0]?.generated_text.at(-1)?.content ?? "";
      post({
        type: "line",
        runId: msg.runId,
        id: job.id,
        text,
        ms: Math.round(performance.now() - started),
      });
    }
    post({ type: "done", runId: msg.runId });
  } catch (err) {
    post({
      type: "error",
      runId: msg.runId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
