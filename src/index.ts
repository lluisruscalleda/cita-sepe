import { loadConfig } from "./config.js";
import { createDriveClient, syncBucketToDrive } from "./drive.js";
import { log } from "./logger.js";
import {
  notifyAvailabilityChange,
  shouldNotifyAvailability,
  type AvailabilityState,
} from "./notify.js";
import {
  formatInZone,
  getNextScheduledPoll,
  msUntil,
} from "./schedule.js";
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
    headless: config.headless,
    runOnce: config.runOnce,
    bucketsDir: config.bucketsDir,
    ntfy: Boolean(config.notifyNtfyUrl),
    pushover: Boolean(config.pushoverApiToken && config.pushoverUserKey),
    scheduleEnabled: Boolean(config.schedule),
    scheduleTimes: config.schedule?.times.length ?? null,
    timezone: config.schedule?.timezone ?? null,
    pollIntervalMs: config.schedule ? null : config.pollIntervalMs,
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
      if (config.schedule && !config.runOnce) {
        const next = getNextScheduledPoll(config.schedule);
        const waitMs = msUntil(next.at);
        log.info("Esperant finestra de schedule (sense consultar SEPE)", {
          window: next.windowLabel,
          burst: next.burstIndex,
          atLocal: formatInZone(next.at, config.schedule.timezone),
          waitSec: Math.round(waitMs / 1000),
        });
        // Sleep in chunks so SIGINT can land reasonably soon
        const chunk = 30_000;
        let remaining = waitMs;
        while (remaining > 0 && !stopping) {
          const step = Math.min(chunk, remaining);
          await sleep(step);
          remaining -= step;
        }
        if (stopping) break;
      }

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

        if (
          shouldNotifyAvailability(
            previous,
            result.availability,
            config.notifyOnEveryAvailable
          )
        ) {
          await notifyAvailabilityChange(config, {
            previous,
            current: result.availability,
            message: result.message,
            bucketPath: result.snapshot.bucketDir,
            at: new Date().toISOString(),
            franjaText: result.franjaText,
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
        } else if (err instanceof SiteBlockedError) {
          log.error("Lloc SEPE bloquejat o error clar", { error: err.message });
        } else {
          log.error("Error en el cicle", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (config.runOnce || stopping) break;

      if (!config.schedule) {
        const elapsed = Date.now() - started;
        const wait = Math.max(0, config.pollIntervalMs - elapsed);
        log.info(`Mode continu: següent consulta en ${Math.round(wait / 1000)}s`);
        await sleep(wait);
      }
      // Amb schedule, el següent cicle espera la propera finestra al capçal del loop
    } while (!stopping);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
