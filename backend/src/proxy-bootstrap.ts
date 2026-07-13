import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

// Route the backend's outbound fetch through the egress proxy when one is
// configured. The VPS public IP geolocates to a region OpenAI blocks, so direct
// embedding calls to api.openai.com return 403; the proxy exits via an allowed
// region. Node's global fetch (undici) ignores HTTP(S)_PROXY env vars unless a
// dispatcher is installed explicitly. NO_PROXY keeps internal services (Qdrant,
// Postgres, n8n) direct. Imported first in server.ts so it runs before any fetch.
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
