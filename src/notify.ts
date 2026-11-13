import { log } from "./logger.js";
import type { AppConfig } from "./config.js";

export type AvailabilityState = "available" | "unavailable" | "unknown";

export type NotifyPayload = {
  previous: AvailabilityState | null;
  current: AvailabilityState;
  message: string;
  bucketPath: string;
  at: string;
  franjaText?: string;
};

/**
 * Notifica al mòbil quan apareix disponibilitat real.
 * Per defecte: només en transició cap a `available` (o primera detecció available).
 * Amb NOTIFY_ON_EVERY_AVAILABLE=true també a cada cicle mentre hi hagi cites.
 */
export function shouldNotifyAvailability(
  previous: AvailabilityState | null,
  current: AvailabilityState,
  notifyOnEveryAvailable: boolean
): boolean {
  if (current !== "available") return false;
  if (notifyOnEveryAvailable) return true;
  return previous !== "available";
}

function summaryLine(payload: NotifyPayload): string {
  return `[cita-sepe] ${payload.previous ?? "?"} → ${payload.current}: ${payload.message}`;
}

async function postWebhook(
  webhookUrl: string,
  payload: NotifyPayload,
  summary: string
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: summary, ...payload }),
  });
  if (!res.ok) {
    log.warn("Webhook notify ha fallat", {
      status: res.status,
      body: (await res.text()).slice(0, 300),
    });
  } else {
    log.info("Webhook notify enviat");
  }
}

/** ntfy.sh — POST al topic URL (p.ex. https://ntfy.sh/el-meu-topic) */
async function postNtfy(ntfyUrl: string, payload: NotifyPayload): Promise<void> {
  const title =
    payload.current === "available"
      ? "SEPE: hi ha cites!"
      : "SEPE cita-sepe";
  const body = [
    payload.message,
    payload.franjaText ? `Detall: ${payload.franjaText.slice(0, 500)}` : null,
    `Bucket: ${payload.bucketPath}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(ntfyUrl, {
    method: "POST",
    headers: {
      Title: title,
      Priority: payload.current === "available" ? "high" : "default",
      Tags: payload.current === "available" ? "calendar,warning" : "warning",
      "Content-Type": "text/plain; charset=utf-8",
    },
    body,
  });
  if (!res.ok) {
    log.warn("ntfy notify ha fallat", {
      status: res.status,
      body: (await res.text()).slice(0, 300),
    });
  } else {
    log.info("ntfy notify enviat");
  }
}

/** Telegram Bot API (opcional) */
async function postTelegram(
  token: string,
  chatId: string,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    log.warn("Telegram notify ha fallat", {
      status: res.status,
      body: (await res.text()).slice(0, 300),
    });
  } else {
    log.info("Telegram notify enviat");
  }
}

/** Pushover — PUSHOVER_API_TOKEN + PUSHOVER_USER_KEY */
async function postPushover(
  apiToken: string,
  userKey: string,
  payload: NotifyPayload
): Promise<void> {
  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: apiToken,
      user: userKey,
      title:
        payload.current === "available"
          ? "SEPE: hi ha cites!"
          : "SEPE cita-sepe",
      message: [
        payload.message,
        payload.franjaText ? payload.franjaText.slice(0, 400) : null,
      ]
        .filter(Boolean)
        .join("\n"),
      priority: payload.current === "available" ? 1 : 0,
    }),
  });
  if (!res.ok) {
    log.warn("Pushover notify ha fallat", {
      status: res.status,
      body: (await res.text()).slice(0, 300),
    });
  } else {
    log.info("Pushover notify enviat");
  }
}

export async function notifyAvailabilityChange(
  config: Pick<
    AppConfig,
    | "notifyWebhookUrl"
    | "notifyNtfyUrl"
    | "notifyTelegramBotToken"
    | "notifyTelegramChatId"
    | "pushoverApiToken"
    | "pushoverUserKey"
  >,
  payload: NotifyPayload
): Promise<void> {
  const summary = summaryLine(payload);
  console.log(summary);

  const tasks: Promise<void>[] = [];

  if (config.notifyNtfyUrl) {
    tasks.push(
      postNtfy(config.notifyNtfyUrl, payload).catch((err) => {
        log.warn("ntfy error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  if (config.pushoverApiToken && config.pushoverUserKey) {
    tasks.push(
      postPushover(
        config.pushoverApiToken,
        config.pushoverUserKey,
        payload
      ).catch((err) => {
        log.warn("Pushover error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  if (config.notifyWebhookUrl) {
    tasks.push(
      postWebhook(config.notifyWebhookUrl, payload, summary).catch((err) => {
        log.warn("Webhook notify error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  if (config.notifyTelegramBotToken && config.notifyTelegramChatId) {
    tasks.push(
      postTelegram(
        config.notifyTelegramBotToken,
        config.notifyTelegramChatId,
        summary
      ).catch((err) => {
        log.warn("Telegram error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  if (tasks.length === 0) {
    log.info("Notify stub (cap canal configurat)", payload);
    return;
  }

  await Promise.all(tasks);
}
