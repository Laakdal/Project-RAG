import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDriveSource, setRefreshToken } from "../settings/drive-sources.js";
import { verifyState, exchangeCode } from "./google.js";

// Public OAuth callback (no session): Google redirects here after consent. The
// `state` param (HMAC-signed source id) is what authenticates the request.
const router = Router();

router.get("/google/callback", async (req: Request, res: Response) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const back = (status: string) => res.redirect(`${config.OAUTH_SUCCESS_URL}?drive=${status}`);

  if (req.query.error) return back("denied");
  const sourceId = verifyState(state);
  if (!sourceId || !code) return back("invalid");
  const source = getDriveSource(sourceId);
  if (!source) return back("notfound");

  try {
    const refreshToken = await exchangeCode(source.clientId, source.clientSecret, code);
    if (!refreshToken) return back("norefresh");
    await setRefreshToken(sourceId, refreshToken);
    return back("connected");
  } catch {
    return back("error");
  }
});

export const oauthRouter = router;
