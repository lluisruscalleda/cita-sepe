import fs from "node:fs/promises";
import path from "node:path";
import { google, type drive_v3 } from "googleapis";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";

type DriveClient = {
  drive: drive_v3.Drive;
  rootFolderId: string;
};

async function loadCredentials(config: AppConfig): Promise<object | null> {
  if (config.googleCredentialsJson) {
    return JSON.parse(config.googleCredentialsJson) as object;
  }
  if (config.googleCredentialsPath) {
    try {
      const raw = await fs.readFile(config.googleCredentialsPath, "utf8");
      return JSON.parse(raw) as object;
    } catch (err) {
      log.warn("No s'ha pogut llegir GOOGLE_APPLICATION_CREDENTIALS", {
        path: config.googleCredentialsPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return null;
}

export async function createDriveClient(
  config: AppConfig
): Promise<DriveClient | null> {
  if (!config.googleDriveFolderId) {
    log.info("Google Drive desactivat (falta GOOGLE_DRIVE_FOLDER_ID)");
    return null;
  }
  const credentials = await loadCredentials(config);
  if (!credentials) {
    log.info(
      "Google Drive desactivat (falten credencials). Es desa només a ./buckets"
    );
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });
  return { drive, rootFolderId: config.googleDriveFolderId };
}

async function findChildFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string | null> {
  const q = [
    `'${parentId}' in parents`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ].join(" and ");
  const res = await drive.files.list({
    q,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

async function ensureFolder(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<string> {
  const existing = await findChildFolder(drive, parentId, name);
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) {
    throw new Error(`No s'ha pogut crear la carpeta Drive: ${name}`);
  }
  return created.data.id;
}

async function uploadFile(
  drive: drive_v3.Drive,
  folderId: string,
  localPath: string
): Promise<void> {
  const name = path.basename(localPath);
  const { createReadStream } = await import("node:fs");
  await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media: {
      body: createReadStream(localPath),
    },
    fields: "id",
    supportsAllDrives: true,
  });
}

/**
 * Puja un bucket local `YYYY-MM-DD/HH-MM-SS` a Drive sota la carpeta arrel.
 * Estructura: <root>/buckets/YYYY-MM-DD/HH-MM-SS/{oficinas.png,oficinas.html,meta.json}
 */
export async function syncBucketToDrive(
  client: DriveClient | null,
  localBucketDir: string,
  relativeBucket: string
): Promise<string | null> {
  if (!client) return null;

  const [datePart, timePart] = relativeBucket.split(/[\\/]/);
  if (!datePart || !timePart) {
    throw new Error(`relativeBucket invàlid: ${relativeBucket}`);
  }

  const bucketsRoot = await ensureFolder(
    client.drive,
    client.rootFolderId,
    "buckets"
  );
  const dayFolder = await ensureFolder(client.drive, bucketsRoot, datePart);
  const runFolder = await ensureFolder(client.drive, dayFolder, timePart);

  const entries = await fs.readdir(localBucketDir);
  for (const name of entries) {
    const full = path.join(localBucketDir, name);
    const st = await fs.stat(full);
    if (st.isFile()) {
      await uploadFile(client.drive, runFolder, full);
    }
  }

  log.info("Bucket pujat a Google Drive", {
    relativeBucket,
    folderId: runFolder,
  });
  return runFolder;
}
