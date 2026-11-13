# cita-sepe

**CA:** Robot que consulta la cita prèvia del SEPE només a les **finestres d’horari de Premià de Mar** definides a `schedule.json` (`Europe/Madrid`, dilluns–divendres). Desa **snapshots** del bloc d’oficines `#cntOficinasPrincipal` en **buckets** datats, amb Google Drive i avisos al mòbil opcionals.

**ES:** Robot que consulta la cita previa del SEPE solo en las **ventanas del horario de Premià de Mar** de `schedule.json` (`Europe/Madrid`, lunes–viernes). Guarda snapshots del bloque de oficinas en buckets fechados; Drive y notificaciones al móvil son opcionales.

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
| `SCHEDULE_ENABLED` | Horari Premià (`true`). `false` = mode continu cada `POLL_INTERVAL_MS` (5 min) | `true` |
| `SCHEDULE_FILE` | JSON d’horari | `./schedule.json` |
| `SCHEDULE_TIMEZONE` | Zona horària | `Europe/Madrid` |
| `POLL_SCHEDULE` | Llista `HH:MM` (sobreescriu JSON) | (buit) |
| `SCHEDULE_WEEKDAYS` | 1=lun…7=dg | (del JSON) |
| `SCHEDULE_BURST_OFFSETS_MS` | Offsets per finestra (ms) | `0,60000` |
| `POLL_INTERVAL_MS` | Només si `SCHEDULE_ENABLED=false` | `300000` |
| `HEADLESS` | `true`/`false` | `true` |
| `BUCKETS_DIR` | Carpeta local de snapshots | `./buckets` |
| `NOTIFY_NTFY_URL` | Topic ntfy.sh (push al mòbil) | (buit) |
| `PUSHOVER_USER_KEY` | User key de Pushover | (buit) |
| `PUSHOVER_API_TOKEN` | API token / app de Pushover | (buit) |
| `NOTIFY_WEBHOOK_URL` | Webhook JSON opcional | (buit) |
| `NOTIFY_ON_EVERY_AVAILABLE` | `true` = avisa cada cicle amb cites | `false` |
| `GOOGLE_DRIVE_FOLDER_ID` | Carpeta Drive arrel | (buit = només local) |
| `GOOGLE_APPLICATION_CREDENTIALS` | JSON del compte de servei | — |

> Les credencials (Drive, Pushover, NIF) **no** es fan commit: van a `.env` (ignorat per git).

## Com executar / Cómo ejecutar

### Una sola consulta

```bash
npm run once
```

### Procés llarg (recomanat)

```bash
npm start
```

Manté **una sola sessió/navegador** i consulta a cada finestra de `schedule.json` (Premià).

## Horari Premià de Mar (defecte)

Segons el cartell *CITA PREVIA SEPE PREMIÀ DE MAR* (`Europe/Madrid`, dilluns–divendres):

`08:30 08:42 08:54 09:06 09:18 09:30 09:42 09:54 10:06 10:18` · gap · `11:18 11:30 11:42 11:54 12:06 12:18 12:30 12:42 12:54 13:06 13:18`

A cada finestra fa un **burst** a `T` i `T+1 min` (`SCHEDULE_BURST_OFFSETS_MS`). Edita `schedule.json` o `POLL_SCHEDULE` per altres oficines.

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

Preferible `systemd` + `npm start` (el procés ja respecta l’horari Premià). Si useu cron, no cal disparar cada 5 min: millor `npm start` en background o cron alineat amb `schedule.json`. Vegeu `deploy/cita-sepe.cron.example`.

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

## Notificacions al mòbil (ntfy / Pushover)

El robot llegeix `#info-franja-disponible` / el bloc d’oficines. Si el text és el de *«no podem oferir cites»* → `unavailable`. Si hi ha forats/cites reals → `available` i **només llavors** envia push (no a cada consulta mentre segueixi available, tret que `NOTIFY_ON_EVERY_AVAILABLE=true`).

Pots activar **ntfy**, **Pushover**, o tots dos.

### ntfy.sh (gratis, senzill)

1. Instal·la l’app **ntfy** (Android / iOS / escriptori): https://ntfy.sh/
2. A l’app, **Subscribe to topic** amb un nom llarg i secret (ex. `cita-sepe-abc123xyz`).
3. Al `.env`:

```env
NOTIFY_NTFY_URL=https://ntfy.sh/cita-sepe-abc123xyz
```

4. Prova: `curl -d "prova cita-sepe" "$NOTIFY_NTFY_URL"`

### Pushover (app de pagament únic)

1. Crea compte a https://pushover.net/ i instal·la l’app al mòbil.
2. Copia el **User Key** del dashboard.
3. Crea una **Application** i copia l’**API Token/Key**.
4. Al `.env`:

```env
PUSHOVER_USER_KEY=el_teu_user_key
PUSHOVER_API_TOKEN=el_teu_api_token
```

### Altres (opcional)

- `NOTIFY_WEBHOOK_URL` — POST JSON genèric
- `NOTIFY_TELEGRAM_BOT_TOKEN` + `NOTIFY_TELEGRAM_CHAT_ID` — bot de Telegram

## Què fa cada cicle

1. (Schedule) Dorm fins a la propera finestra; **no** consulta SEPE mentrestant.
2. Obre el portal SEPE (o l’URL directa de citaprevia si l’iframe falla).
3. Omple CP / tràmit / subtràmit / NIF i canal **Presencial**.
4. Captura `#cntOficinasPrincipal` / `#info-franja-disponible`.
5. Desa el bucket (i Drive si hi ha credencials).
6. Si l’estat passa a **available**, notifica (ntfy / Pushover / webhook).

## Logs i bloquejos

- **OK / sense cites / possible disponibilitat** al log.
- **CAPTCHA**: s’atura el cicle amb error clar (no es resol automàticament). Torna-ho a provar més tard o amb `HEADLESS=false`.
- Errors de xarxa: reintents amb backoff (`MAX_RETRIES`, `RETRY_BASE_MS`).
- Respecteu el lloc: un sol procés; amb schedule no cal pegar fora de les finestres; en mode continu useu `POLL_INTERVAL_MS` ≥ 5 min.

## Desenvolupament

```bash
npm run build   # typecheck
npm run once    # prova manual
```

Scripts d’exploració a `scripts/` (no necessaris per produir).

## Avís

Ús personal / responsable. El SEPE pot mostrar CAPTCHA o bloquejar IPs (p. ex. cloud). Si passa, el codi queda llest per executar-se des d’una IP residencial.
