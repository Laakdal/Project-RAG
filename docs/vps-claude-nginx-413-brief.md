# Brief for the VPS Claude — fix 413 on chat uploads (nginx body size)

Paste everything in the code block below into the Claude Code session on the VPS. Symptom: uploading
a PDF/DOCX larger than ~1MB to the Project RAG chat fails with nginx "413 Request Entity Too Large"
(confirmed: a 2MB upload direct to api.ariorafa.site returns 413 from nginx, before reaching the
backend). Cause: nginx `client_max_body_size` defaults to 1MB. The backend accepts up to 20MB.

```
TASK: Raise the upload body-size limit for api.ariorafa.site. Uploads >1MB to the
Project RAG backend get nginx "413 Request Entity Too Large" because client_max_body_size
defaults to 1MB. The backend (rag_backend) accepts up to 20MB; align nginx to that.

STEPS:
1. Edit the dockerized nginx vhost for api.ariorafa.site
   (e.g. /opt/rag-skripsi-stack/nginx/conf.d/api.ariorafa.site.conf — find the server
   block that proxy_passes to rag_backend). Back it up first.
2. Add inside that server block (it can also go in the location / block):
       client_max_body_size 25m;
3. Validate + reload (do NOT restart; don't disrupt n8n):
       docker exec rag_nginx nginx -t
       docker exec rag_nginx nginx -s reload
4. Verify: a >1MB upload should now get past nginx to the backend (no more nginx 413).

GUARDRAILS: only edit the api.ariorafa.site vhost; back it up; reload (not restart) nginx;
don't touch n8n/postgres/qdrant or the n8n.ariorafa.site vhost.

When done, report: the file edited, the nginx -t result, and confirmation nginx reloaded.
```

## Notes
- `25m` gives headroom above the backend's own 20MB multer limit. Files 1–20MB will now pass nginx
  and be accepted by the backend; 20–25MB pass nginx but the backend returns a clean 413; >25MB nginx
  rejects. Adjust the number if you want a different ceiling (keep it ≥ the backend's 20MB).
- This is server-side only — no frontend rebuild or backend redeploy needed. After the reload, just
  retry the upload in the browser.
