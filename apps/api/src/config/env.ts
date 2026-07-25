import { z } from "zod";

/**
 * Zod-validated process.env -> typed config object. Fails fast (with a clear,
 * itemized error) if a required variable is missing, instead of surfacing a
 * confusing crash later at first use.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_PASSWORD: z.string().optional(),

  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  // MusicBrainz's API etiquette asks for a descriptive User-Agent identifying
  // the application (and ideally a contact URL) -- see
  // modules/library/metadataProviders/musicBrainzProvider.ts.
  MUSICBRAINZ_USER_AGENT: z.string().default("SpectadoRadio/0.1 (self-hosted; no contact url configured)"),

  // Not in .env.example; inside docker-compose the encoder/api reach NATS via
  // the service name on the compose network.
  NATS_URL: z.string().default("nats://nats:4222"),
  NATS_USER: z.string().default("api"),
  API_NATS_PASSWORD: z.string().min(1, "API_NATS_PASSWORD is required"),

  // v1 shared, static, subscribe-only credential handed to every authenticated
  // manager -- see modules/realtime/realtime.routes.ts for the full rationale.
  // Falls back to a dev-only default if the operator hasn't set it yet.
  CONTROL_PANEL_NATS_PASSWORD: z.string().default("change-me"),

  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  ENCODER_CALLBACK_TOKEN: z.string().min(1, "ENCODER_CALLBACK_TOKEN is required"),

  PUBLIC_BASE_URL: z.string().default("http://localhost"),
});

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === "production",
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL,

  database: {
    url: env.DATABASE_URL,
  },

  redis: {
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
  },

  s3: {
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  },

  musicBrainzUserAgent: env.MUSICBRAINZ_USER_AGENT,

  nats: {
    url: env.NATS_URL,
    user: env.NATS_USER,
    password: env.API_NATS_PASSWORD,
  },

  controlPanelNats: {
    user: "control-panel",
    password: env.CONTROL_PANEL_NATS_PASSWORD,
  },

  jwt: {
    secret: env.JWT_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  },

  encoderCallbackToken: env.ENCODER_CALLBACK_TOKEN,
} as const;

export type Config = typeof config;
