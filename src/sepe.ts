import { chromium, type Browser, type Frame, type Page } from "playwright";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";
import type { AvailabilityState } from "./notify.js";
import { saveOfficesSnapshot, type SnapshotResult } from "./snapshot.js";

export class CaptchaBlockedError extends Error {
  constructor(message = "CAPTCHA detectat: cal intervenció manual") {
    super(message);
    this.name = "CaptchaBlockedError";
  }
}

export class SiteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteBlockedError";
  }
}

export type PollResult = {
  availability: AvailabilityState;
  message: string;
  snapshot: SnapshotResult;
  usedDirectUrl: boolean;
};

const NO_CITAS_RE =
  /no podem oferir cites|no podemos ofrecer citas|no hi ha cites|no hay citas/i;
const HAS_SLOT_RE =
  /primer hueco|primer forat|disponible|hueco disponible|forat disponible/i;

function classifyAvailability(text: string): {
  availability: AvailabilityState;
  message: string;
} {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return { availability: "unknown", message: "Bloc d'oficines buit" };
  }
  if (NO_CITAS_RE.test(trimmed)) {
    return {
      availability: "unavailable",
      message: "Sense cites: missatge «no podem oferir cites»",
    };
  }
  if (HAS_SLOT_RE.test(trimmed) || /oficina/i.test(trimmed)) {
    return {
      availability: "available",
      message: "Possible disponibilitat d'oficines/cites",
    };
  }
  return { availability: "unknown", message: trimmed.slice(0, 240) };
}

async function acceptCookies(page: Page): Promise<void> {
  const btn = page.locator(".js-cookies-accept, .js-cookies-reject").first();
  try {
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.click({ timeout: 3000 });
    }
  } catch {
    // ignore
  }
}

async function detectCaptcha(root: Page | Frame): Promise<boolean> {
  return root.evaluate(() => {
    const el = document.querySelector("#cntCaptchaPrevioMapa");
    if (!el) return false;
    if (el.classList.contains("oculto")) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

async function openForm(
  page: Page,
  config: AppConfig
): Promise<{ root: Page | Frame; usedDirectUrl: boolean }> {
  log.info("Obrint portal SEPE", { url: config.portalUrl });
  const resp = await page.goto(config.portalUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  if (resp && resp.status() >= 400) {
    throw new SiteBlockedError(`Portal HTTP ${resp.status()}`);
  }
  await acceptCookies(page);

  const iframe = page.frameLocator('iframe[src*="citapreviasepe"]');
  try {
    await iframe
      .locator("#select2-datosCodigoPostal-container, #datosCodigoPostal")
      .first()
      .waitFor({ timeout: 20_000 });
    const frame = page.frames().find((f) => f.url().includes("citapreviasepe"));
    if (frame) {
      log.info("Formulari dins de l'iframe");
      return { root: frame, usedDirectUrl: false };
    }
  } catch {
    log.warn("Iframe no disponible; s'obre l'URL directa de citaprevia");
  }

  const direct = await page.goto(config.directUrl, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  if (direct && direct.status() >= 400) {
    throw new SiteBlockedError(`Citaprevia HTTP ${direct.status()}`);
  }
  await page
    .locator("#select2-datosCodigoPostal-container")
    .waitFor({ timeout: 30_000 });
  return { root: page, usedDirectUrl: true };
}

async function selectCodigoPostal(
  root: Page | Frame,
  page: Page,
  cp: string
): Promise<void> {
  await root.locator("#select2-datosCodigoPostal-container").click();
  // Select2 pot pintar el cercador dins l'iframe o al document pare
  const searchRoot = root.locator(".select2-search__field").last();
  const searchPage = page.locator(".select2-search__field").last();
  const search =
    (await searchRoot.count().catch(() => 0)) > 0 ? searchRoot : searchPage;
  await search.waitFor({ timeout: 10_000 });
  await search.fill("");
  const prefix = cp.slice(0, 3);
  await search.type(prefix, { delay: 60 });
  // Les opcions s'injecten quan term.length === 3 (mapaListadosCp)
  const optRoot = root
    .locator(".select2-results__option")
    .filter({ hasText: new RegExp(`^${cp}\\b`) })
    .first();
  const optPage = page
    .locator(".select2-results__option")
    .filter({ hasText: new RegExp(`^${cp}\\b`) })
    .first();
  try {
    await optRoot.waitFor({ timeout: 5_000 });
    await optRoot.click();
  } catch {
    await optPage.waitFor({ timeout: 15_000 });
    await optPage.click();
  }
  await root.locator("#comboNivelServicio1").waitFor({ timeout: 20_000 });
}

async function fillStep1(root: Page | Frame, page: Page, config: AppConfig): Promise<void> {
  await selectCodigoPostal(root, page, config.codigoPostal);
  log.info("Codi postal seleccionat", { cp: config.codigoPostal });

  const tipo = root.locator("#comboNivelServicio1");
  const tipoVal = await tipo.inputValue().catch(() => "");
  if (tipoVal !== config.tipoOficina) {
    const has = await tipo.locator(`option[value="${config.tipoOficina}"]`).count();
    if (has) {
      await tipo.selectOption(config.tipoOficina);
    } else {
      // PRESTACIONS sol ser l'única opció
      const first = await tipo.locator("option").first().getAttribute("value");
      if (first) await tipo.selectOption(first);
    }
  }

  await root.locator("#comboNivelServicio2").waitFor({ timeout: 15_000 });
  await root.locator("#comboNivelServicio2").selectOption(config.tramit);
  log.info("Tràmit seleccionat", { tramit: config.tramit });

  await root.locator("#comboTiposServicios").waitFor({ timeout: 15_000 });
  await root.locator("#comboTiposServicios").selectOption(config.subtramit);
  log.info("Subtràmit seleccionat", { subtramit: config.subtramit });
  await page.waitForTimeout(800);

  if (await detectCaptcha(root)) {
    throw new CaptchaBlockedError();
  }

  // Omple NIF si el camp és visible
  const dniVisible = await root.evaluate(() => {
    const cnt = document.querySelector("#cntDNI");
    const input = document.querySelector("#inputDNI") as HTMLInputElement | null;
    if (!cnt || !input) return false;
    if (cnt.classList.contains("oculto")) return false;
    const style = getComputedStyle(cnt);
    return style.display !== "none" && style.visibility !== "hidden";
  });

  if (dniVisible) {
    const tipoDoc = root
      .locator(
        "#divComboTiposDocumentos select, #comboTiposDocumentos select, select[id*='Documento' i]"
      )
      .first();
    if (await tipoDoc.count()) {
      const nifOpt = tipoDoc.locator("option").filter({ hasText: /NIF/i }).first();
      if (await nifOpt.count()) {
        const value = await nifOpt.getAttribute("value");
        if (value) await tipoDoc.selectOption(value);
      }
    }
    await root.locator("#inputDNI").fill(config.nif);
    log.info("NIF informat");
  } else {
    // Intenta omplir igualment (alguns fluxos mantenen el camp ocult però validable)
    if (await root.locator("#inputDNI").count()) {
      await root.locator("#inputDNI").fill(config.nif);
      log.debug("NIF omplert (camp ocult)");
    }
  }

  await root.locator("#btnContinuar1").click();
  await page.waitForTimeout(1500);

  if (await detectCaptcha(root)) {
    throw new CaptchaBlockedError(
      "CAPTCHA després de Continuar: no es pot completar automàticament"
    );
  }

  // Errors de validació al pas 1
  const err = await root
    .locator(".mensaje-error, .mensajeInfo.mensaje-error")
    .allTextContents();
  const joined = err.map((s) => s.trim()).filter(Boolean).join(" | ");
  if (joined && /captcha|bloquej|bloquead|error/i.test(joined)) {
    if (/captcha/i.test(joined)) throw new CaptchaBlockedError(joined);
    throw new SiteBlockedError(joined);
  }

  await root.locator("#comboCanales").waitFor({ timeout: 30_000 });
}

async function selectCanalAndWaitOffices(
  root: Page | Frame,
  page: Page,
  canal: string
): Promise<void> {
  await root.locator("#comboCanales").selectOption(canal);
  log.info("Canal seleccionat", { canal });
  // Espera contingut del bloc d'oficines (missatge o llista)
  await page.waitForTimeout(1500);
  await root
    .locator("#cntOficinasPrincipal, #cntOficinas, #info-franja-disponible")
    .first()
    .waitFor({ timeout: 30_000 });
  // Dona temps a la resposta AJAX de càrrega d'oficines
  const waitRoot = "evaluate" in root && "waitForFunction" in root ? root : page;
  await waitRoot
    .waitForFunction(
      () => {
        const el =
          document.querySelector("#cntOficinasPrincipal") ||
          document.querySelector("#cntOficinas");
        const text = el?.textContent?.trim() || "";
        return (
          text.length > 40 &&
          !/Seleccioni el canal|Seleccione el canal|SELECCIONEU EL CANAL/i.test(
            text
          )
        );
      },
      { timeout: 30_000 }
    )
    .catch(() => {
      // pot fallar si el text és curt; el snapshot ja capturarà l'estat
    });
}

export async function runPoll(
  browser: Browser,
  config: AppConfig
): Promise<PollResult> {
  const context = await browser.newContext({
    locale: "ca-ES",
    viewport: { width: 1400, height: 1100 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    const { root, usedDirectUrl } = await openForm(page, config);
    await fillStep1(root, page, config);
    await selectCanalAndWaitOffices(root, page, config.canal);

    const snapshot = await saveOfficesSnapshot({
      root,
      page,
      bucketsDir: config.bucketsDir,
      meta: {
        codigoPostal: config.codigoPostal,
        tramit: config.tramit,
        subtramit: config.subtramit,
        canal: config.canal,
        nifMasked: `${config.nif.slice(0, 3)}***${config.nif.slice(-1)}`,
        usedDirectUrl,
      },
    });

    const { availability, message } = classifyAvailability(snapshot.text);
    log.info("Resultat consulta", { availability, message });
    return { availability, message, snapshot, usedDirectUrl };
  } finally {
    await context.close();
  }
}

export async function launchBrowser(config: AppConfig): Promise<Browser> {
  return chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetries<T>(
  config: AppConfig,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof CaptchaBlockedError || err instanceof SiteBlockedError) {
        throw err;
      }
      const delay = config.retryBaseMs * Math.pow(2, attempt - 1);
      log.warn(`${label} fallida (intent ${attempt}/${config.maxRetries})`, {
        error: err instanceof Error ? err.message : String(err),
        retryInMs: delay,
      });
      if (attempt < config.maxRetries) {
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
