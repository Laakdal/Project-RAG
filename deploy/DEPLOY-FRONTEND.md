# Frontend deploy (VPS) — ariorafa.site

This branch (`vps-frontend`) carries the frontend plus its VPS deploy files.
Deploy it alongside the existing backend (api.ariorafa.site) on the same host.

## Prerequisites

- DNS: an A record for `ariorafa.site` pointing to this VPS's public IP
  (confirm with `dig +short ariorafa.site` before requesting TLS).
- Docker, nginx, and certbot already installed (same host as the backend).

## Steps

1. Fetch this branch on the VPS:

   ```bash
   git fetch origin && git checkout vps-frontend && git pull
   ```

2. Build and start the frontend (published on 127.0.0.1:3000):

   ```bash
   docker compose -f docker-compose.frontend.vps.yml up -d --build
   ```

3. Install the nginx vhost and issue TLS:

   ```bash
   sudo cp deploy/nginx/ariorafa.site.conf /etc/nginx/sites-available/ariorafa.site
   sudo ln -s /etc/nginx/sites-available/ariorafa.site /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d ariorafa.site
   ```

4. Verify:

   ```bash
   curl -I https://ariorafa.site        # 200 + valid cert
   ```

   Then log in at https://ariorafa.site and confirm chat + file upload work.

## Notes

- `NEXT_PUBLIC_*` and `BACKEND_ORIGIN` bake at BUILD time — any change needs
  `docker compose -f docker-compose.frontend.vps.yml up -d --build` again.
- The browser only ever talks to ariorafa.site; Next proxies backend calls to
  `BACKEND_ORIGIN`, so the session/CSRF cookies stay first-party. Over HTTPS,
  `COOKIE_SAMESITE=lax` on the backend is the cleaner choice.
- `BACKEND_ORIGIN` defaults to the public `https://api.ariorafa.site`. To cut a
  network hop, attach the frontend service to the backend's Docker network and
  set `BACKEND_ORIGIN=http://<backend-service>:4000`, then rebuild.
- To ship new frontend work: push commits to `vps-frontend`, then on the VPS
  `git pull` and rerun step 2.
