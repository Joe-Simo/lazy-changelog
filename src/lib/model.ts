export const MODEL_ID = "onnx-community/gemma-3-1b-it-ONNX";
export const MODEL_NAME = "Gemma 3 1B";

/** Download sizes of the weight files, read from the model repo on Hugging Face. */
export const BACKENDS = {
  webgpu: {
    device: "webgpu",
    dtype: "q4f16",
    sizeLabel: "about 760 MB",
    externalData: true,
  },
  // The 4-bit file needs an operator the WebAssembly runtime lacks, so the CPU path uses 8-bit weights.
  wasm: {
    device: "wasm",
    dtype: "uint8",
    sizeLabel: "about 1 GB",
    externalData: false,
  },
} as const;

export type Backend = keyof typeof BACKENDS;

export type WorkerRequest =
  | { type: "load"; backend: Backend }
  | {
      type: "rewrite";
      runId: number;
      jobs: { id: string; messages: { role: string; content: string }[] }[];
    }
  | { type: "cancel"; runId: number };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; backend: Backend }
  | { type: "line"; runId: number; id: string; text: string; ms: number }
  | { type: "done"; runId: number }
  | { type: "error"; message: string; runId?: number };

export async function detectBackend(): Promise<Backend> {
  try {
    const gpu = (
      navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }
    ).gpu;
    if (gpu && (await gpu.requestAdapter())) return "webgpu";
  } catch {
    // Fall through to WebAssembly.
  }
  return "wasm";
}
