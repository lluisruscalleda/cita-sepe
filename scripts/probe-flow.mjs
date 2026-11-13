import { chromium } from "playwright";
import fs from "fs";

const URL = "https://citaprevia-sede.sepe.gob.es/citapreviasepe/?origen=sepe&codidioma=ca";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await (
  await browser.newContext({
    locale: "ca-ES",
    viewport: { width: 1400, height: 1100 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  })
).newPage();

const api = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/citapreviasepe\/cita\//.test(u)) {
    let body = "";
    try {
      body = (await r.text()).slice(0, 500);
    } catch {}
    api.push({ status: r.status(), url: u, body });
  }
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#datosCodigoPostal", { timeout: 30000 });

// Wait a bit for any delayed postal load
await page.waitForTimeout(2000);
let optionCount = await page.locator("#datosCodigoPostal option").count();
console.log("initial postal options:", optionCount);

if (optionCount <= 1) {
  // Load postal codes via known endpoint or inject
  // Try common endpoints
  const idCliente = await page.locator("#idCliente").inputValue();
  console.log("idCliente", idCliente);

  // Search page source / network for postal loader
  const postalApi = await page.evaluate(async () => {
    const tries = [
      "/citapreviasepe/cita/cargaCodigosPostales",
      "/citapreviasepe/cita/obtenerCodigosPostales",
      "/citapreviasepe/cita/codigosPostales",
      "/citapreviasepe/cita/dameCodigosPostales",
    ];
    const out = [];
    for (const t of tries) {
      try {
        const r = await fetch(t + "?idCliente=39");
        out.push({ t, status: r.status, len: (await r.text()).length });
      } catch (e) {
        out.push({ t, err: String(e) });
      }
    }
    return out;
  });
  console.log("postal api tries", postalApi);

  // Inject CP with approximate coords for Premià de Mar / 08330
  await page.evaluate(() => {
    const sel = document.getElementById("datosCodigoPostal");
    const opt = document.createElement("option");
    opt.value = "08330";
    opt.textContent = "08330 - Premià de Mar";
    opt.setAttribute("data-latitud", "41.492");
    opt.setAttribute("data-longitud", "2.362");
    sel.appendChild(opt);
    $("#datosCodigoPostal").val("08330").trigger("change");
  });
  await page.waitForTimeout(2500);
}

// Select PRESTACIONS if needed (often auto-selected)
const nivel1 = page.locator("#comboNivelServicio1");
await nivel1.waitFor({ timeout: 15000 });
const n1 = await nivel1.inputValue();
console.log("nivel1", n1, await nivel1.locator("option").allTextContents());
if (n1 !== "146") {
  await nivel1.selectOption("146");
  await page.waitForTimeout(1000);
}

// Select tramit 158
await page.locator("#comboNivelServicio2").waitFor({ timeout: 10000 });
await page.locator("#comboNivelServicio2").selectOption("158");
await page.waitForTimeout(2000);

let niveles = await page.evaluate(() =>
  [...document.querySelectorAll("[id^=comboNivelServicio]")].map((el) => ({
    id: el.id,
    val: el.value,
    options: [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 80) })),
  }))
);
console.log("niveles after 158", JSON.stringify(niveles, null, 2));

// If subtramit exists, select 8
const nivel3 = page.locator("#comboNivelServicio3");
if (await nivel3.count()) {
  const opts = await nivel3.locator("option").evaluateAll((os) =>
    os.map((o) => ({ v: o.value, t: o.textContent.trim() }))
  );
  console.log("nivel3 options", opts);
  if (opts.some((o) => o.v === "8")) {
    await nivel3.selectOption("8");
  } else {
    // maybe value is different - try selecting first non-empty or matching text
    const pick = opts.find((o) => o.v && o.v !== "");
    if (pick) await nivel3.selectOption(pick.v);
  }
  await page.waitForTimeout(1500);
}

// Check for more levels / DNI / captcha
const state = await page.evaluate(() => {
  const visible = (el) => el && !el.classList.contains("oculto") && getComputedStyle(el).display !== "none";
  return {
    niveles: [...document.querySelectorAll("[id^=comboNivelServicio]")].map((el) => ({
      id: el.id,
      val: el.value,
      options: [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim().slice(0, 80), ultimo: o.dataset.ultimonivel, servicio: o.dataset.esservicio, jerarquia: o.dataset.idsjerarquiatramites })),
    })),
    dniVisible: visible(document.querySelector("#cntDNI")),
    captchaVisible: visible(document.querySelector("#cntCaptchaPrevioMapa")),
    tiposDoc: document.querySelector("#divComboTiposDocumentos")?.innerHTML?.slice(0, 1000),
    inputDoc: document.querySelector("#divComboInputTiposDocumentos")?.innerHTML?.slice(0, 1000),
    mensajes: [...document.querySelectorAll(".mensajeInfo,.mensaje-error")].map((e) => e.innerText.trim()).filter(Boolean),
  };
});
console.log("STATE", JSON.stringify(state, null, 2));

// Fill NIF
if (state.dniVisible || (await page.locator("#inputDNI").isVisible().catch(() => false))) {
  // select NIF type if combo exists
  const tipoDoc = page.locator("#divComboTiposDocumentos select, #comboTiposDocumentos select, select[id*=Documento], select[id*=documento]").first();
  if (await tipoDoc.count()) {
    const opts = await tipoDoc.locator("option").evaluateAll((os) =>
      os.map((o) => ({ v: o.value, t: o.textContent.trim() }))
    );
    console.log("doc types", opts);
    const nif = opts.find((o) => /NIF/i.test(o.t)) || opts.find((o) => o.v && o.v !== "");
    if (nif) await tipoDoc.selectOption(nif.v);
  }
  await page.locator("#inputDNI").fill(process.env.SEPE_NIF || "YOUR_NIF");
}

await page.screenshot({ path: "/tmp/probe-before-continue.png", fullPage: true });

// Continue
await page.locator("#btnContinuar1").click();
await page.waitForTimeout(4000);
await page.screenshot({ path: "/tmp/probe-after-continue.png", fullPage: true });

const step2 = await page.evaluate(() => {
  const visible = (el) => el && !el.classList.contains("oculto") && getComputedStyle(el).display !== "none";
  return {
    url: location.href,
    captchaVisible: visible(document.querySelector("#cntCaptchaPrevioMapa")),
    captchaMsg: document.querySelector("#mensajeInfo_recaptcha_datosPrevioMapa")?.innerText,
    mensajes: [...document.querySelectorAll(".mensajeInfo,.mensaje-error,.mensaje-aviso")].map((e) => e.innerText.trim()).filter(Boolean),
    canalesHtml: document.querySelector("#comboCanales")?.outerHTML?.slice(0, 2000),
    canalesOptions: document.querySelector("#comboCanales")
      ? [...document.querySelector("#comboCanales").options].map((o) => ({ v: o.value, t: o.textContent.trim() }))
      : null,
    oficinas: document.querySelector("#cntOficinasPrincipal")?.outerHTML?.slice(0, 3000)
      || document.querySelector("#cntOficinas")?.outerHTML?.slice(0, 3000),
    bodySnippet: document.body.innerText.slice(0, 1500),
  };
});
console.log("STEP2", JSON.stringify(step2, null, 2));
console.log("API", JSON.stringify(api, null, 2));

fs.writeFileSync("/tmp/probe-step2.json", JSON.stringify({ step2, api, state }, null, 2));
await browser.close();
