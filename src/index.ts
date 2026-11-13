import { loadConfig } from "./config.js";
import { createDriveClient, syncBucketToDrive } from "./drive.js";
import { log } from "./logger.js";
import {
  notifyAvailabilityChange,
  type AvailabilityState,
} from "./notify.js";
import {
  CaptchaBlockedError,
  SiteBlockedError,
  launchBrowser,
  runPoll,
  sleep,
  withRetries,
} from "./sepe.js";

async function main(): Promise<void> {
  const config = loadConfig();
  log.info("Inici robot cita SEPE", {
    cp: config.codigoPostal,
    tramit: config.tramit,
    subtramit: config.subtramit,
    intervalMs: config.pollIntervalMs,
    headless: config.headless,
    runOnce: config.runOnce,
    bucketsDir: config.bucketsDir,
  });

  const drive = await createDriveClient(config);
  const browser = await launchBrowser(config);
  let previous: AvailabilityState | null = null;
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Aturant per ${signal}...`);
    await browser.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    do {
      const started = Date.now();
      try {
        const result = await withRetries(config, "Consulta SEPE", () =>
          runPoll(browser, config)
        );

        await syncBucketToDrive(
          drive,
          result.snapshot.bucketDir,
          result.snapshot.relativeBucket
        ).catch((err) => {
          log.warn("Sync Drive fallida (es manté el bucket local)", {
            error: err instanceof Error ? err.message : String(err),
          });
        });

        if (previous !== null && previous !== result.availability) {
          await notifyAvailabilityChange(config.notifyWebhookUrl, {
            previous,
            current: result.availability,
            message: result.message,
            bucketPath: result.snapshot.bucketDir,
            at: new Date().toISOString(),
          });
        } else {
          log.info("Estat", {
            availability: result.availability,
            message: result.message,
            bucket: result.snapshot.relativeBucket,
          });
        }
        previous = result.availability;
      } catch (err) {
        if (err instanceof CaptchaBlockedError) {
          log.error("CAPTCHA / bloqueig anti-bot", { error: err.message });
          await notifyAvailabilityChange(config.notifyWebhookUrl, {
            previous,
            current: "unknown",
            message: err.message,
            bucketPath: config.bucketsDir,
            at: new Date().toISOString(),
          });
        } else if (err instanceof SiteBlockedError) {
          log.error("Lloc SEPE bloquejat o error clar", { error: err.message });
        } else {
          log.error("Error en el cicle", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (config.runOnce || stopping) break;

      const elapsed = Date.now() - started;
      const wait = Math.max(0, config.pollIntervalMs - elapsed);
      log.info(`Següent consulta en ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    } while (!stopping);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
