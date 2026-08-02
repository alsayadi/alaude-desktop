/**
 * Curated catalog of local models users can download via Ollama.
 *
 * Each entry routes through `ollama pull <id>`. Users can also pull any custom
 * tag via the "Pull custom model" input in the UI — this list is just the
 * highlighted set.
 *
 * Sizes are approximate Q4 quantization sizes from the Ollama library.
 */

module.exports = [
  // ── New since April 2026 ──────────────────────────────────────────────────
  // Only tags containing a `:` are listed. provider-registry routes a model
  // to Ollama on the `name:tag` shape, so colon-less releases (Cohere's
  // north-mini-code-1.0, Poolside's laguna-xs-2.1) would mis-route to a
  // cloud provider and are deliberately left out until that check is widened.
  {
    id: 'gemma4:12b',
    name: 'Gemma 4 · 12B',
    family: 'gemma',
    sizeGb: 7.6,
    context: 262144,
    tags: ['balanced', 'quality', 'multimodal'],
    description: 'Gemma 4 12B (June 2026) — the size that was missing between E4B and 26B. 256K context, multimodal.',
  },
  {
    id: 'lfm2.5:8b',
    name: 'Liquid LFM2.5 · 8B',
    family: 'lfm',
    sizeGb: 5.2,
    context: 128000,
    tags: ['fast', 'balanced'],
    description: 'Liquid AI LFM2.5 8B-A1B — sparse MoE built for laptops. Very fast on Apple Silicon.',
  },
  {
    id: 'minicpm-v4.6:1b',
    name: 'MiniCPM-V 4.6 · 1B',
    family: 'minicpm',
    sizeGb: 1.6,
    context: 262144,
    tags: ['fast', 'vision'],
    description: 'Tiny vision model — reads screenshots and photos on machines with little RAM.',
  },
  {
    id: 'ornith:9b',
    name: 'Ornith 1.0 · 9B',
    family: 'ornith',
    sizeGb: 5.6,
    context: 262144,
    tags: ['coding'],
    description: 'Ornith 1.0 9B — code-focused, 256K context. Fits comfortably on 16 GB machines.',
  },
  {
    id: 'nemotron3:33b',
    name: 'NVIDIA Nemotron 3 · 33B',
    family: 'nemotron',
    sizeGb: 28,
    context: 131072,
    tags: ['quality', 'reasoning'],
    description: 'NVIDIA Nemotron 3 Nano 33B — strong reasoning. Wants 32 GB+ of memory.',
  },
  {
    id: 'ornith:35b',
    name: 'Ornith 1.0 · 35B MoE',
    family: 'ornith',
    sizeGb: 21,
    context: 262144,
    tags: ['coding', 'quality'],
    description: 'Ornith 1.0 35B MoE — the strong open coding model of mid-2026. Needs 24 GB+.',
  },

  // ── Qwen 3.6 (Alibaba · April 2026) ───────────────────────────────────────
  {
    id: 'qwen3.6:latest',
    name: 'Qwen 3.6 · 35B MoE',
    family: 'qwen',
    sizeGb: 24,
    context: 262144,
    tags: ['flagship', 'coding', 'agentic', 'multimodal'],
    description: 'Qwen 3.6 flagship (35B MoE · ~3B active). Agentic coding, repo-level reasoning, 256K context. Text + image.',
  },
  {
    id: 'qwen3.6:35b-a3b-q4_K_M',
    name: 'Qwen 3.6 · Q4',
    family: 'qwen',
    sizeGb: 24,
    context: 262144,
    tags: ['flagship', 'coding', 'multimodal'],
    description: 'Qwen 3.6 35B MoE at Q4_K_M quantization — balanced quality/size.',
  },
  {
    id: 'qwen3.6:35b-a3b-nvfp4',
    name: 'Qwen 3.6 · NVFP4',
    family: 'qwen',
    sizeGb: 22,
    context: 262144,
    tags: ['flagship', 'coding', 'nvidia'],
    description: 'Qwen 3.6 35B MoE at NVFP4 — best speed on NVIDIA Blackwell GPUs (text only).',
  },

  // ── Gemma 4 (Google DeepMind · April 2026) ────────────────────────────────
  {
    id: 'gemma4:e2b',
    name: 'Gemma 4 · E2B',
    family: 'gemma',
    sizeGb: 7.2,
    context: 131072,
    tags: ['fast', 'multimodal'],
    description: 'Gemma 4 effective-2B — smallest new-gen Gemma. 128K context, multimodal.',
  },
  {
    id: 'gemma4:e4b',
    name: 'Gemma 4 · E4B',
    family: 'gemma',
    sizeGb: 9.6,
    context: 131072,
    tags: ['balanced', 'multimodal'],
    description: 'Gemma 4 effective-4B (also :latest). 128K context, multimodal. Great default.',
  },
  {
    id: 'gemma4:26b',
    name: 'Gemma 4 · 26B MoE',
    family: 'gemma',
    sizeGb: 18,
    context: 262144,
    tags: ['quality', 'multimodal'],
    description: 'Gemma 4 26B MoE — #6 on Arena Open LLM. 256K context, multimodal.',
  },
  {
    id: 'gemma4:31b',
    name: 'Gemma 4 · 31B Dense',
    family: 'gemma',
    sizeGb: 20,
    context: 262144,
    tags: ['flagship', 'quality', 'multimodal'],
    description: 'Gemma 4 31B dense — #3 on Arena Open LLM. 256K context, multimodal.',
  },

  // ── Qwen 3 (earlier generation, still excellent) ──────────────────────────
  {
    id: 'qwen3:8b',
    name: 'Qwen 3 · 8B',
    family: 'qwen',
    sizeGb: 4.9,
    context: 32768,
    tags: ['balanced', 'multilingual'],
    description: 'Alibaba Qwen 3 — strong reasoning, excellent Arabic + Chinese support.',
  },
  {
    id: 'qwen3:14b',
    name: 'Qwen 3 · 14B',
    family: 'qwen',
    sizeGb: 8.5,
    context: 32768,
    tags: ['quality', 'multilingual'],
    description: 'Larger Qwen 3 — sharper reasoning, still fits on most 16 GB GPUs.',
  },
  {
    id: 'qwen3:32b',
    name: 'Qwen 3 · 32B',
    family: 'qwen',
    sizeGb: 19,
    context: 32768,
    tags: ['quality'],
    description: 'Flagship Qwen 3 dense model. Needs a serious GPU (24 GB+).',
  },
  {
    id: 'qwen3-coder:30b',
    name: 'Qwen 3 Coder · 30B',
    family: 'qwen',
    sizeGb: 18,
    context: 32768,
    tags: ['coding'],
    description: 'Qwen 3 fine-tuned for code generation and repo-level reasoning.',
  },

  // ── Gemma family (Google) ─────────────────────────────────────────────────
  {
    id: 'gemma3:1b',
    name: 'Gemma 3 · 1B',
    family: 'gemma',
    sizeGb: 0.8,
    context: 32768,
    tags: ['fast'],
    description: 'Tiny Gemma 3 — great for quick drafts and low-RAM machines.',
  },
  {
    id: 'gemma3:4b',
    name: 'Gemma 3 · 4B',
    family: 'gemma',
    sizeGb: 3.3,
    context: 128000,
    tags: ['balanced', 'vision'],
    description: 'Gemma 3 4B with 128k context and image understanding.',
  },
  {
    id: 'gemma3:12b',
    name: 'Gemma 3 · 12B',
    family: 'gemma',
    sizeGb: 8.1,
    context: 128000,
    tags: ['quality', 'vision'],
    description: 'Gemma 3 12B — top choice if you have ≥16 GB of VRAM.',
  },
  {
    id: 'gemma3:27b',
    name: 'Gemma 3 · 27B',
    family: 'gemma',
    sizeGb: 17,
    context: 128000,
    tags: ['quality', 'vision'],
    description: 'Largest Gemma 3. Rivals GPT-4o-mini on many benchmarks.',
  },

  // ── General-purpose extras ────────────────────────────────────────────────
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 · 3B',
    family: 'llama',
    sizeGb: 2.0,
    context: 131072,
    tags: ['fast'],
    description: 'Meta Llama 3.2 3B — compact, quick, decent instruction following.',
  },
  {
    id: 'llama3.3:70b',
    name: 'Llama 3.3 · 70B',
    family: 'llama',
    sizeGb: 43,
    context: 131072,
    tags: ['quality'],
    description: 'Meta Llama 3.3 70B — near-frontier quality. Needs 48 GB+ VRAM.',
  },
  {
    id: 'deepseek-r1:7b',
    name: 'DeepSeek R1 · 7B',
    family: 'deepseek',
    sizeGb: 4.7,
    context: 131072,
    tags: ['reasoning'],
    description: 'DeepSeek R1 distilled — shows its chain-of-thought inside <think> tags.',
  },
  {
    id: 'deepseek-r1:14b',
    name: 'DeepSeek R1 · 14B',
    family: 'deepseek',
    sizeGb: 9,
    context: 131072,
    tags: ['reasoning'],
    description: 'Larger DeepSeek R1 distill — stronger reasoning, more VRAM.',
  },
]
