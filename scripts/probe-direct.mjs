import { chromium } from "playwright";

const URL = "https://citaprevia-sede.sepe.gob.es/citapreviasepe/?origen=sepe&codidioma=ca";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  locale: "ca-ES",
  viewport: { width: 1400, height: 1100 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
});
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE", msg.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url().slice(0, 120));
});

console.log("goto direct...");
const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
console.log("status", resp?.status(), "url", page.url());

await page.screenshot({ path: "/tmp/probe-direct.png", fullPage: true });

const info = await page.evaluate(() => {
  const visible = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    return (
      !el.classList.contains("oculto") &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  };
  return {
    title: document.title,
    hasPostal: !!document.querySelector("#datosCodigoPostal"),
    select2: !!document.querySelector("#select2-datosCodigoPostal-container"),
    captchaVisible: visible(document.querySelector("#cntCaptchaPrevioMapa")),
    captchaClass: document.querySelector("#cntCaptchaPrevioMapa")?.className,
    bodyText: document.body?.innerText?.slice(0, 800),
  };
});
console.log(JSON.stringify(info, null, 2));

if (info.hasPostal) {
  console.log("click select2...");
  await page.locator("#select2-datosCodigoPostal-container").click();
  await page.waitForTimeout(400);
  const search = page.locator(".select2-search__field").last();
  await search.fill("08330");
  await page.waitForTimeout(2000);
  const opts = await page.locator(".select2-results__option").allTextContents();
  console.log("opts", opts.slice(0, 20));
  const match = page.locator(".select2-results__option").filter({ hasText: "08330" }).first();
  if (await match.count()) {
    await match.click();
  } else {
    await search.press("Enter");
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/probe-direct-cp.png", fullPage: true });

  const after = await page.evaluate(() => {
    const selects = [...document.querySelectorAll("select")].map((el) => ({
      id: el.id,
      options: [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 100) })),
    }));
    return {
      nivelHtml: document.querySelector("#divComboServiciosNivel")?.innerHTML?.slice(0, 3000),
      selects,
      captchaClass: document.querySelector("#cntCaptchaPrevioMapa")?.className,
      dniClass: document.querySelector("#cntDNI")?.className,
      tiposDocHtml: document.querySelector("#divComboTiposDocumentos")?.innerHTML?.slice(0, 800),
      inputDocHtml: document.querySelector("#divComboInputTiposDocumentos")?.innerHTML?.slice(0, 800),
    };
  });
  console.log("AFTER", JSON.stringify(after, null, 2));
}

await browser.close();
