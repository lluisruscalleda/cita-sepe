import { log } from "./logger.js";

export type AvailabilityState = "available" | "unavailable" | "unknown";

export type NotifyPayload = {
  previous: AvailabilityState | null;
  current: AvailabilityState;
  message: string;
  bucketPath: string;
  at: string;
};

export async function notifyAvailabilityChange(
  webhookUrl: string | null,
  payload: NotifyPayload
): Promise<void> {
  const summary = `[cita-sepe] ${payload.previous ?? "?"} → ${payload.current}: ${payload.message}`;
  console.log(summary);

  if (!webhookUrl) {
    log.info("Notify stub (sense webhook)", payload);
    return;
  }

  try {
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
  } catch (err) {
    log.warn("Webhook notify error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
