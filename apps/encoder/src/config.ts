import { z } from "zod";

/**
 * zod-validated process environment. Fails fast (throws) at boot if a
 * required var is missing, rather than limping along with `undefined` and
 * failing confusingly later inside an ffmpeg spawn or a NATS auth handshake.
 */
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  LOG_LEVEL: z.string().default("info"),

  // --- NATS ---
  NATS_URL: z.string().min(1).default("nats://nats:4222"),
  NATS_USER: z.string().min(1).default("encoder"),
  NATS_PASSWORD: z.string().min(1, "NATS_PASSWORD is required"),

  // --- API callback (GET /internal/playback/next) ---
  API_CALLBACK_URL: z.string().url().default("http://api:3000/internal"),
  API_CALLBACK_TOKEN: z.string().min(1, "API_CALLBACK_TOKEN is required"),
  API_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),

  // --- HLS output ---
  HLS_OUTPUT_DIR: z.string().min(1).default("/data/hls"),

  // --- PCM bus FIFO ---
  PCM_FIFO_PATH: z.string().min(1).default("/run/encoder/pcm/master.fifo"),

  // --- status ---
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),

  // --- live mic websocket ---
  LIVE_MIC_WS_PORT: z.coerce.number().int().positive().default(8080),
});

export interface EncoderConfig {
  nodeEnv: string;
  logLevel: string;
  natsUrl: string;
  natsUser: string;
  natsPassword: string;
  apiCallbackUrl: string;
  apiCallbackToken: string;
  apiTimeoutMs: number;
  hlsOutputDir: string;
  pcmFifoPath: string;
  heartbeatIntervalMs: number;
  liveMicWsPort: number;
}

/**
 * Parses and validates `process.env` (or an injected object, handy for
 * tests). Throws a readable error listing every invalid/missing var.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EncoderConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid encoder environment configuration:\n${issues}`);
  }

  const data = parsed.data;
  return {
    nodeEnv: data.NODE_ENV,
    logLevel: data.LOG_LEVEL,
    natsUrl: data.NATS_URL,
    natsUser: data.NATS_USER,
    natsPassword: data.NATS_PASSWORD,
    apiCallbackUrl: data.API_CALLBACK_URL,
    apiCallbackToken: data.API_CALLBACK_TOKEN,
    apiTimeoutMs: data.API_TIMEOUT_MS,
    hlsOutputDir: data.HLS_OUTPUT_DIR,
    pcmFifoPath: data.PCM_FIFO_PATH,
    heartbeatIntervalMs: data.HEARTBEAT_INTERVAL_MS,
    liveMicWsPort: data.LIVE_MIC_WS_PORT,
  };
}
