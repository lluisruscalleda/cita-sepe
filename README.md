# cita-sepe

Robot que consulta cada **5 minuts** la cita prèvia del SEPE (prestacions), fa un **snapshot** (captura + HTML) del bloc d’oficines `#cntOficinasPrincipal` i el desa en **buckets** datats (`buckets/YYYY-MM-DD/HH-MM-SS/`), amb pujada opcional a **Google Drive**.

Bot que consulta cada **5 minutos** la cita previa del SEPE, guarda snapshots del bloque de oficinas y los sincroniza con Google Drive (opcional).

## Requisits / Requisitos

- Node.js **≥ 20**
- Dependències Playwright (s’instal·len amb `npm install`)
- (Opcional) Compte de servei Google Cloud amb accés a Drive

## Instal·lació / Instalación

```bash
git clone https://github.com/lluisruscalleda/cita-sepe.git
cd cita-sepe
npm install
cp .env.example .env
# Edita .env amb el teu NIF, CP, interval, etc.
```

## Configuració (`.env`)

| Variable | Descripció | Defecte |
|---|---|---|
| `SEPE_CODIGO_POSTAL` | Codi postal | `08330` |
| `SEPE_NIF` | NIF/NIE | (el del teu cas) |
| `SEPE_TIPO_OFICINA` | Tipus oficina (PRESTACIONS) | `146` |
| `SEPE_TRAMIT` | Valor del tràmit | `158` |
| `SEPE_SUBTRAMIT` | Valor del subtràmit | `8` |
| `SEPE_CANAL` | Canal PRESENCIAL | `1` |
| `POLL_INTERVAL_MS` | Interval entre consultes | `300000` (5 min) |
| `HEADLESS` | `true`/`false` | `true` |
| `BUCKETS_DIR` | Carpeta local de snapshots | `./buckets` |
| `NOTIFY_WEBHOOK_URL` | Webhook si canvia la disponibilitat | (buit) |
| `GOOGLE_DRIVE_FOLDER_ID` | Carpeta Drive arrel | (buit = només local) |
| `GOOGLE_APPLICATION_CREDENTIALS` | JSON del compte de servei | — |

> Les credencials de Drive **no** es fan commit. El NIF/CP van a `.env` (ignorat per git).

## Com executar / Cómo ejecutar

### Una sola consulta

```bash
npm run once
```

### Bucle continu (recomanat)

```bash
npm start
```

Manté **una sola sessió/navegador** i consulta cada `POLL_INTERVAL_MS` (5 min per defecte).

### systemd

```bash
sudo mkdir -p /opt/cita-sepe
sudo rsync -a ./ /opt/cita-sepe/
# Copia .env i credencials a /opt/cita-sepe/
sudo cp deploy/cita-sepe.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cita-sepe.service
sudo journalctl -u cita-sepe -f
```

### cron (alternativa)

Vegeu `deploy/cita-sepe.cron.example` (`npm run once` cada 5 minuts). Preferible `systemd` + `npm start` per respectar una sola sessió i backoff.

## Google Drive — buckets

Estructura local i a Drive:

```text
buckets/
  2026-11-13/
    14-05-00/
      oficinas.png
      oficinas.html
      meta.json
```

### Opció A — API Google Drive (integrada)

1. Crea un projecte a [Google Cloud Console](https://console.cloud.google.com/).
2. Activa **Google Drive API**.
3. Crea un **compte de servei** i descarrega el JSON.
4. Comparteix una carpeta de Drive amb l’email del compte de servei (editor).
5. Copia l’**ID** de la carpeta (a la URL `.../folders/ID`).
6. Al `.env`:

```env
GOOGLE_DRIVE_FOLDER_ID=ID_DE_LA_CARPETA
GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
```

Sense aquestes variables, el robot **només escriu a `./buckets/`**.

### Opció B — rclone (extern)

```bash
rclone config   # remote "gdrive"
# Sincronitza després de cada execució o amb un timer:
rclone sync ./buckets gdrive:cita-sepe/buckets
```

## Què fa cada cicle

1. Obre el portal SEPE (o l’URL directa de citaprevia si l’iframe falla).
2. Omple CP (`08330` via Select2), PRESTACIONS, tràmit `158`, subtràmit `8`, NIF.
3. Continua → a «SELECCIONEU EL CANAL» tria **Presencial** (`1`).
4. Captura `#cntOficinasPrincipal` (screenshot + HTML), incloent el missatge *«En aquests moments no podem oferir cites…»* si no n’hi ha.
5. Desa el bucket local i el puja a Drive si hi ha credencials.
6. Registra èxit/fracàs i, si canvia la disponibilitat, crida el stub de notify (consola / webhook).

## Logs i bloquejos

- **OK / sense cites / possible disponibilitat** al log.
- **CAPTCHA**: s’atura el cicle amb error clar (no es resol automàticament). Torna-ho a provar més tard o amb `HEADLESS=false`.
- Errors de xarxa: reintents amb backoff (`MAX_RETRIES`, `RETRY_BASE_MS`).
- Respecteu el lloc: interval ≥ 5 min, un sol procés.

## Desenvolupament

```bash
npm run build   # typecheck
npm run once    # prova manual
```

Scripts d’exploració a `scripts/` (no necessaris per produir).

## Avís

Ús personal / responsable. El SEPE pot mostrar CAPTCHA o bloquejar IPs (p. ex. cloud). Si passa, el codi queda llest per executar-se des d’una IP residencial.
