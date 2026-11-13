import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ quiet: true });

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Falta la variable d'entorn obligatòria: ${name}`);
  }
  return v;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} ha de ser un nombre vàlid`);
  }
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export type AppConfig = {
  codigoPostal: string;
  nif: string;
  tipoOficina: string;
  tramit: string;
  subtramit: string;
  canal: string;
  pollIntervalMs: number;
  headless: boolean;
  portalUrl: string;
  directUrl: string;
  bucketsDir: string;
  maxRetries: number;
  retryBaseMs: number;
  notifyWebhookUrl: string | null;
  googleDriveFolderId: string | null;
  googleCredentialsPath: string | null;
  googleCredentialsJson: string | null;
  runOnce: boolean;
};

export function loadConfig(argv = process.argv.slice(2)): AppConfig {
  return {
    codigoPostal: env("SEPE_CODIGO_POSTAL", "08330"),
    nif: env("SEPE_NIF"),
    tipoOficina: env("SEPE_TIPO_OFICINA", "146"),
    tramit: env("SEPE_TRAMIT", "158"),
    subtramit: env("SEPE_SUBTRAMIT", "8"),
    canal: env("SEPE_CANAL", "1"),
    pollIntervalMs: envInt("POLL_INTERVAL_MS", 300_000),
    headless: envBool("HEADLESS", true),
    portalUrl: env(
      "SEPE_PORTAL_URL",
      "https://sede.sepe.gob.es/portalSede/ca/procedimientos-y-servicios/personas/proteccion-por-desempleo/cita-previa/cita-previa-solicitud.html"
    ),
    directUrl: env(
      "SEPE_DIRECT_URL",
      "https://citaprevia-sede.sepe.gob.es/citapreviasepe/?origen=sepe&codidioma=ca"
    ),
    bucketsDir: path.resolve(env("BUCKETS_DIR", "./buckets")),
    maxRetries: envInt("MAX_RETRIES", 3),
    retryBaseMs: envInt("RETRY_BASE_MS", 5_000),
    notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL?.trim() || null,
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null,
    googleCredentialsPath:
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || null,
    googleCredentialsJson:
      process.env.GOOGLE_DRIVE_CREDENTIALS_JSON?.trim() || null,
    runOnce: argv.includes("--once"),
  };
}
