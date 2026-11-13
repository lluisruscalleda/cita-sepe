import { chromium } from "playwright";
import fs from "fs";

const DIRECT = "https://citaprevia-sede.sepe.gob.es/citapreviasepe/?origen=sepe&codidioma=ca";

async function selectPostal(page, cp) {
  await page.locator("#select2-datosCodigoPostal-container").click();
  const search = page.locator(".select2-search__field").last();
  const prefix = cp.slice(0, 3);
  await search.fill("");
  await search.type(prefix, { delay: 80 });
  await page.waitForTimeout(800);
  // type remaining or select
  const opt = page.locator(".select2-results__option").filter({ hasText: cp }).first();
  await opt.waitFor({ timeout: 10000 });
  await opt.click();
  await page.waitForSelector("#comboNivelServicio1", { timeout: 15000 });
}

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

await page.goto(DIRECT, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector("#select2-datosCodigoPostal-container");

await selectPostal(page, "08330");
console.log("CP selected");

await page.locator("#comboNivelServicio2").selectOption("158");
await page.waitForSelector("#comboTiposServicios", { timeout: 15000 });
await page.locator("#comboTiposServicios").selectOption("8");
await page.waitForTimeout(1500);
console.log("tramit+subtramit selected");

// DNI visibility
const dniInfo = await page.evaluate(() => {
  const cnt = document.querySelector("#cntDNI");
  return {
    className: cnt?.className,
    visible: cnt && !cnt.classList.contains("oculto"),
    inputExists: !!document.querySelector("#inputDNI"),
    tipos: document.querySelector("#divComboTiposDocumentos")?.innerHTML?.slice(0, 800),
  };
});
console.log("dni", dniInfo);

if (dniInfo.visible || (await page.locator("#inputDNI").isVisible().catch(() => false))) {
  const tipo = page.locator("#comboTiposDocumentos select, #divComboTiposDocumentos select, select[id*='TipoDocumento'], select[id*='tiposDocumento']").first();
  if (await tipo.count()) {
    const opts = await tipo.evaluate((el) =>
      [...el.options].map((o) => ({ v: o.value, t: o.textContent.trim() }))
    );
    console.log("docTypes", opts);
    const nif = opts.find((o) => /NIF/i.test(o.t)) || opts.find((o) => o.v);
    if (nif) await tipo.selectOption(nif.v);
  }
  await page.locator("#cntDNI").evaluate((el) => el.classList.remove("oculto"));
  await page.locator("#inputDNI").fill(process.env.SEPE_NIF || "YOUR_NIF");
} else {
  // force show and fill - checkDNI may need a moment
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    document.querySelector("#cntDNI")?.classList.remove("oculto");
    document.querySelector("#comboTiposDocumentos")?.classList.remove("oculto");
  });
  if (await page.locator("#inputDNI").count()) {
    await page.locator("#inputDNI").fill(process.env.SEPE_NIF || "YOUR_NIF");
  }
}

await page.screenshot({ path: "/tmp/e2e-step1.png", fullPage: true });
await page.locator("#btnContinuar1").click();
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/e2e-step2.png", fullPage: true });

let step2 = await page.evaluate(() => {
  const visible = (el) =>
    !!el && !el.classList.contains("oculto") && getComputedStyle(el).display !== "none";
  return {
    mensajes: [...document.querySelectorAll(".mensajeInfo,.mensaje-error,.mensaje-aviso")]
      .map((e) => e.innerText.trim())
      .filter(Boolean),
    captchaVisible: visible(document.querySelector("#cntCaptchaPrevioMapa")),
    canales: document.querySelector("#comboCanales")
      ? [...document.querySelector("#comboCanales").options].map((o) => ({
          v: o.value,
          t: o.textContent.trim(),
        }))
      : null,
    oficinasOuter: (
      document.querySelector("#cntOficinasPrincipal") ||
      document.querySelector("#cntOficinas")
    )?.outerHTML?.slice(0, 2000),
    text: document.body.innerText.slice(0, 2000),
    pestana: document.querySelector(".pasoActivo, .active, .seleccionado")?.innerText,
  };
});
console.log("STEP2", JSON.stringify(step2, null, 2));

if (step2.canales?.length) {
  await page.locator("#comboCanales").selectOption("1");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: "/tmp/e2e-oficinas.png", fullPage: true });
  const offices = await page.evaluate(() => {
    const el =
      document.querySelector("#cntOficinasPrincipal") ||
      document.querySelector("li.cnt-oficinas-principal") ||
      document.querySelector("#cntOficinas");
    return {
      id: el?.id,
      className: el?.className,
      text: el?.innerText?.slice(0, 2000),
      html: el?.outerHTML?.slice(0, 4000),
      noCitas: /no podem oferir|no podemos ofrecer|no hi ha cites|no hay citas/i.test(
        el?.innerText || document.body.innerText
      ),
    };
  });
  console.log("OFFICES", JSON.stringify(offices, null, 2));
  fs.writeFileSync("/tmp/e2e-offices.html", offices.html || "");
}

await browser.close();
