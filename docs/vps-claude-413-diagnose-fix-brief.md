# Brief for the VPS Claude — DIAGNOSE + FIX + VERIFY the 413 upload limit

Two prior attempts to raise nginx's upload limit did NOT take effect (a 2MB upload to
api.ariorafa.site still returns "413 Request Entity Too Large" from nginx). This brief forces a
diagnose → fix → **verify with a real upload** flow so "done" actually means fixed. Paste the block
below into the Claude Code session on the VPS.

```
TASK: Fix nginx returning "413 Request Entity Too Large" for uploads to api.ariorafa.site.
The Project RAG chat backend (rag_backend) accepts 20MB, but nginx (the dockerized rag_nginx
that fronts api.ariorafa.site) rejects anything over ~1MB. TWO prior attempts did not take
effect, so this time DIAGNOSE, FIX, and VERIFY WITH A REAL UPLOAD before reporting done.

STEP 1 — DIAGNOSE (run and SHOW the output):
  docker exec rag_nginx sh -c 'echo "== conf.d =="; ls -la /etc/nginx/conf.d/; echo "== client_max_body_size in effective config =="; nginx -T 2>&1 | grep -in client_max_body_size; echo "== nginx -t =="; nginx -t'
  Note: does any client_max_body_size appear in the effective config and at what value? Does nginx -t pass?
  Also find where rag_nginx actually mounts its config (the prior file may have gone to an unmounted path):
  docker inspect rag_nginx --format '{{ range .Mounts }}{{ .Source }} -> {{ .Destination }}{{ println }}{{ end }}'

STEP 2 — APPLY (global http-context directive, so it can't miss the right server block):
  Identify the HOST directory that maps to /etc/nginx/conf.d in the rag_nginx container (from the
  docker inspect mounts above). Write a tiny global config into THAT host dir, e.g. if it maps from
  /opt/rag-skripsi-stack/nginx/conf.d:
     echo 'client_max_body_size 25m;' | sudo tee /opt/rag-skripsi-stack/nginx/conf.d/00-upload-size.conf
  conf.d files are included inside nginx's http{} block, so this applies to ALL server blocks.
  (If nginx config is NOT mounted — baked into the image — instead edit the api.ariorafa.site server
  block that has `listen 443` + `proxy_pass ...rag_backend` and add client_max_body_size 25m; there.)

STEP 3 — VALIDATE + RELOAD (separately; do NOT chain with && so a -t warning can't silently skip the reload):
  docker exec rag_nginx nginx -t
  (MUST print "syntax is ok" and "test is successful". If it FAILS, fix the reported cause first.)
  docker exec rag_nginx nginx -s reload

STEP 4 — VERIFY WITH A REAL UPLOAD (mandatory — prior attempts skipped this):
  head -c 2000000 /dev/zero | tr '\0' A > /tmp/big.bin
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -F 'file=@/tmp/big.bin' https://api.ariorafa.site/chat/conversations/x/attachments
  Expected: 401 (auth) or 400 — anything EXCEPT 413. If still 413, the directive is NOT in the active
  config: re-check the mount path and that nginx actually reloaded, then repeat.
  Confirm it's now in the effective config:
  docker exec rag_nginx nginx -T 2>&1 | grep -in client_max_body_size      # should show 25m

GUARDRAILS: only add the upload-size config; do NOT edit n8n's vhost or restart other services;
reload (not restart) nginx; n8n.ariorafa.site must keep working.

REPORT back: (1) the STEP 1 diagnosis output, (2) the nginx -t result, (3) the STEP 4 curl status
code (must NOT be 413), and (4) the final client_max_body_size value from nginx -T.
```

## Why this should finally work
- It sets the limit at **http context** (a conf.d file applies to every server block), so it can't go
  into the wrong `:80`-vs-`:443` server block.
- It checks the **actual mount path** (`docker inspect`) in case the prior file went somewhere nginx
  doesn't read.
- It runs `nginx -t` and `reload` **separately** so a failed test can't silently skip the reload.
- It **proves** the fix with a real >1MB upload (must return anything but 413) before reporting done.
