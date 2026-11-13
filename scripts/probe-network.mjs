import { chromium } from "playwright";

const URL = "https://citaprevia-sede.sepe.gob.es/citapreviasepe/?origen=sepe&codidioma=ca";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await (await browser.newContext({
  locale: "ca-ES",
  viewport: { width: 1400, height: 1100 },
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
})).newPage();

const interesting = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/codigo|postal|cp|nivel|servicio|oficina|captcha|cliente|json|xml/i.test(u) && !/\.(css|js|png|jpg|gif|woff)/i.test(u)) {
    interesting.push({ status: r.status(), url: u.slice(0, 200), ct: r.headers()["content-type"] });
  }
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(3000);

const optionCount = await page.locator("#datosCodigoPostal option").count();
console.log("postal options count:", optionCount);
console.log("interesting responses:", JSON.stringify(interesting, null, 2));

// Check hidden fields
const hidden = await page.evaluate(() => {
  const ids = [
    "idCliente",
    "codigoEntidad",
    "inputCP",
    "latitudCP",
    "longitudCP",
    "usaBloqueoIframe",
    "paramAPP",
  ];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    out[id] = el ? el.value : null;
  }
  // look for scripts mentioning postal load
  const scripts = [...document.scripts]
    .map((s) => s.src || s.textContent.slice(0, 100))
    .filter((s) => /postal|codigo/i.test(s));
  out.scriptHints = scripts.slice(0, 20);
  return out;
});
console.log("hidden", JSON.stringify(hidden, null, 2));

// Try setting option manually and triggering change
await page.evaluate(() => {
  const sel = document.getElementById("datosCodigoPostal");
  const opt = document.createElement("option");
  opt.value = "08330";
  opt.textContent = "08330";
  opt.setAttribute("data-latitud", "41.474");
  opt.setAttribute("data-longitud", "2.319");
  sel.appendChild(opt);
  sel.value = "08330";
  $(sel).trigger("change");
  if (typeof seleccionDeCodigoPostal === "function") seleccionDeCodigoPostal();
});

await page.waitForTimeout(4000);
await page.screenshot({ path: "/tmp/probe-manual-cp.png", fullPage: true });

const after = await page.evaluate(() => {
  const selects = [...document.querySelectorAll("select, [id^=comboNivel]")].map((el) => ({
    id: el.id,
    tag: el.tagName,
    options: el.tagName === "SELECT" ? [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 100) })) : null,
    html: el.outerHTML.slice(0, 300),
  }));
  return {
    nivel: document.querySelector("#divComboServiciosNivel")?.innerHTML?.slice(0, 4000),
    selects,
    messages: [...document.querySelectorAll(".mensajeInfo, .mensaje-error")].map((e) => e.textContent.trim()).filter(Boolean),
    captchaClass: document.querySelector("#cntCaptchaPrevioMapa")?.className,
  };
});
console.log("AFTER MANUAL", JSON.stringify(after, null, 2));

await browser.close();
