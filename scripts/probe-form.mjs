import { chromium } from "playwright";

const URL =
  "https://sede.sepe.gob.es/portalSede/ca/procedimientos-y-servicios/personas/proteccion-por-desempleo/cita-previa/cita-previa-solicitud.html";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
  locale: "ca-ES",
  viewport: { width: 1400, height: 1100 },
});

page.on("console", (msg) => console.log("CONSOLE", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));

console.log("goto portal...");
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// cookies
const accept = page.locator(".js-cookies-accept").first();
if (await accept.isVisible().catch(() => false)) {
  await accept.click();
  console.log("cookies accepted");
}

const frame = page.frameLocator('iframe[src*="citapreviasepe"]');
await frame.locator("#datosCodigoPostal").waitFor({ timeout: 60000 });
console.log("form frame ready");

// dump visible structure
const dump = await frame.locator("body").evaluate((body) => {
  const visible = (el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.offsetParent !== null;
  };
  const ids = [...body.querySelectorAll("[id]")].map((el) => ({
    id: el.id,
    tag: el.tagName,
    cls: el.className?.toString?.().slice(0, 80) || "",
    visible: visible(el),
  }));
  const selects = [...body.querySelectorAll("select")].map((el) => ({
    id: el.id,
    options: [...el.options].slice(0, 20).map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 60) })),
    visible: visible(el),
  }));
  const captcha = body.querySelector("#cntCaptchaPrevioMapa");
  return {
    title: document.title,
    captchaVisible: captcha ? visible(captcha) : false,
    captchaClass: captcha?.className || null,
    select2Container: !!body.querySelector("#select2-datosCodigoPostal-container"),
    selects,
    interestingIds: ids.filter((x) =>
      /codigo|postal|nivel|dni|nif|captcha|canal|oficina|continuar|servicio/i.test(x.id)
    ),
  };
});
console.log(JSON.stringify(dump, null, 2));

await page.screenshot({ path: "/tmp/probe-portal.png", fullPage: true });
console.log("screenshot /tmp/probe-portal.png");

// Try filling postal code via select2
console.log("opening select2 postal...");
await frame.locator("#select2-datosCodigoPostal-container").click();
await page.waitForTimeout(500);
const search = page.locator(".select2-search__field").last();
await search.fill("08330");
await page.waitForTimeout(1500);
const opts = await page.locator(".select2-results__option").allTextContents();
console.log("postal options:", opts.slice(0, 15));
const match = page.locator(".select2-results__option", { hasText: "08330" }).first();
if (await match.count()) {
  await match.click();
  console.log("selected 08330");
} else {
  console.log("no 08330 option; pressing Enter");
  await search.press("Enter");
}

await page.waitForTimeout(2500);
const afterCp = await frame.locator("body").evaluate((body) => {
  const htmlNivel = body.querySelector("#divComboServiciosNivel")?.innerHTML?.slice(0, 2000) || "";
  const htmlServ = body.querySelector("#divComboServicios")?.innerHTML?.slice(0, 1000) || "";
  const selects = [...body.querySelectorAll("select")].map((el) => ({
    id: el.id,
    options: [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 80) })),
  }));
  const captcha = body.querySelector("#cntCaptchaPrevioMapa");
  const dniVisible = !body.querySelector("#cntDNI")?.classList.contains("oculto");
  return {
    htmlNivel,
    htmlServ,
    selects,
    captchaClass: captcha?.className || null,
    dniVisible,
    dniHtml: body.querySelector("#divComboInputTiposDocumentos")?.innerHTML?.slice(0, 500) || "",
  };
});
console.log("AFTER CP:", JSON.stringify(afterCp, null, 2));
await page.screenshot({ path: "/tmp/probe-after-cp.png", fullPage: true });

await browser.close();
