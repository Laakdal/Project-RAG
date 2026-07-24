import { google } from "googleapis";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webUrl: string;
  // Bytes, as a numeric string, when Drive reports it (native files). Google
  // Docs/Sheets/Slides have no size and leave this undefined.
  size?: string;
};

export type DriveCreds = { clientId: string; clientSecret: string; refreshToken: string };

// Build a Drive client for a specific OAuth-connected account (one per Drive
// source). The library auto-refreshes access tokens from the refresh token.
function driveClient(creds: DriveCreds) {
  if (!creds.refreshToken) throw new Error("Drive source not connected");
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return google.drive({ version: "v3", auth });
}

export async function listFolder(creds: DriveCreds, folderId: string): Promise<DriveFile[]> {
  const drive = driveClient(creds);
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
export async function searchFiles(creds: DriveCreds, driveQuery: string, limit = 5): Promise<DriveFile[]> {
  const drive = driveClient(creds);
  const res = await drive.files.list({
    q: driveQuery,
    fields: "files(id, name, mimeType, modifiedTime, webViewLink, size)",
    pageSize: limit,
    orderBy: "modifiedTime desc",
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    modifiedTime: f.modifiedTime!,
    webUrl: f.webViewLink ?? "",
    size: f.size ?? undefined,
  }));
}

export async function downloadFile(creds: DriveCreds, file: DriveFile): Promise<{ buffer: Buffer; mimeType: string }> {
  const drive = driveClient(creds);
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
