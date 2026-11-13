import fs from "node:fs/promises";
import path from "node:path";
import type { Page, Frame, Locator } from "playwright";
import { log } from "./logger.js";

export type SnapshotResult = {
  bucketDir: string;
  relativeBucket: string;
  screenshotPath: string;
  htmlPath: string;
  metaPath: string;
  text: string;
  html: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function makeBucketParts(now = new Date()): {
  date: string;
  time: string;
  relative: string;
} {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return { date, time, relative: path.join(date, time) };
}

export async function saveOfficesSnapshot(opts: {
  root: Page | Frame;
  page: Page;
  bucketsDir: string;
  meta: Record<string, unknown>;
}): Promise<SnapshotResult> {
  const { root, page, bucketsDir, meta } = opts;
  const parts = makeBucketParts();
  const bucketDir = path.join(bucketsDir, parts.relative);
  await fs.mkdir(bucketDir, { recursive: true });

  const target: Locator = root.locator("#cntOficinasPrincipal").first();
  const fallback: Locator = root.locator("#cntOficinas").first();

  let locator = target;
  let html = "";
  let text = "";

  if (await target.count()) {
    html = (await target.evaluate((el) => el.outerHTML)) ?? "";
    text = (await target.innerText().catch(() => "")) || "";
  } else if (await fallback.count()) {
    locator = fallback;
    html = (await fallback.evaluate((el) => el.outerHTML)) ?? "";
    text = (await fallback.innerText().catch(() => "")) || "";
  } else {
    html = await root.locator("body").evaluate((el) => el.innerHTML);
    text = await root.locator("body").innerText();
  }

  const screenshotPath = path.join(bucketDir, "oficinas.png");
  const htmlPath = path.join(bucketDir, "oficinas.html");
  const metaPath = path.join(bucketDir, "meta.json");

  try {
    if (await locator.count()) {
      await locator.screenshot({ path: screenshotPath });
    } else {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
  } catch {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  await fs.writeFile(htmlPath, html, "utf8");
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        ...meta,
        capturedAt: new Date().toISOString(),
        textPreview: text.slice(0, 2000),
        relativeBucket: parts.relative,
      },
      null,
      2
    ),
    "utf8"
  );

  log.info("Snapshot local desat", { bucketDir });
  return {
    bucketDir,
    relativeBucket: parts.relative,
    screenshotPath,
    htmlPath,
    metaPath,
    text,
    html,
  };
}
