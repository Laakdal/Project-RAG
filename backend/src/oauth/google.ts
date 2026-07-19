import { google } from "googleapis";
import crypto from "node:crypto";
import { config } from "../config.js";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// Sign the source id into the OAuth `state` param (HMAC) so the callback can
// trust which Drive source is being connected without a session cookie.
export function signState(sourceId: string): string {
  const ts = String(Math.floor(Date.now() / 1000));
  const payload = `${sourceId}:${ts}`;
  const sig = crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyState(state: string): string | null {
  try {
    const [sourceId, ts, sig] = Buffer.from(state, "base64url").toString("utf8").split(":");
    if (!sourceId || !ts || !sig) return null;
    const expected = crypto.createHmac("sha256", config.SESSION_SECRET).update(`${sourceId}:${ts}`).digest("hex");
    if (sig !== expected) return null;
    if (Date.now() / 1000 - Number(ts) > 600) return null; // 10-minute window
    return sourceId;
  } catch {
    return null;
  }
}

export function buildAuthUrl(clientId: string, clientSecret: string, state: string): string {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, config.OAUTH_REDIRECT_URL);
  return oauth2.generateAuthUrl({
    access_type: "offline", // needed to get a refresh token
    prompt: "consent", // force a refresh token every time
    scope: SCOPES,
    state,
  });
}

// Exchange the authorization code for tokens; returns the refresh token.
export async function exchangeCode(clientId: string, clientSecret: string, code: string): Promise<string | null> {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, config.OAUTH_REDIRECT_URL);
  const { tokens } = await oauth2.getToken(code);
  return tokens.refresh_token ?? null;
}
