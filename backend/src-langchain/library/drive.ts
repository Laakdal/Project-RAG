import { google } from "googleapis";
import { config } from "../../src/config.js";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webUrl: string;
};

function driveClient() {
  if (!config.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON required");
  const credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const drive = driveClient();
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
      pageSize: 100,
      pageToken,
    });
    for (const f of res.data.files ?? []) {
      out.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime!,
        webUrl: f.webViewLink ?? "",
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

// Full-text / name search across the files the service account can see (the
// shared PalmCo corpus). Used by the on-demand Drive lookup node for documents
// that are not in the pre-indexed library. `driveQuery` is a Drive `q` string.
export async function searchFiles(driveQuery: string, limit = 5): Promise<DriveFile[]> {
  const drive = driveClient();
  const res = await drive.files.list({
    q: driveQuery,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink)",
    pageSize: limit,
    orderBy: "modifiedTime desc",
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime!,
    webUrl: f.webViewLink ?? "",
  }));
}

export async function downloadFile(file: DriveFile): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = driveClient();
  if (file.mimeType.startsWith("application/vnd.google-apps")) {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "application/pdf" },
      { responseType: "arraybuffer" },
    );
    return { buffer: Buffer.from(res.data as unknown as ArrayBuffer), mimeType: "application/pdf" };
  }
  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return { buffer: Buffer.from(res.data as unknown as ArrayBuffer), mimeType: file.mimeType };
}
