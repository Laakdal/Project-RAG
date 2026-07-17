# n8n workflows

Versioned exports of the n8n workflows that run the live RAG pipeline on the VPS
(`rag_n8n`, https://n8n.ariorafa.site). These are the source of truth for prod
behaviour that previously lived **only** inside the running n8n instance — export
them here whenever a workflow changes so the whole project stays reproducible from git.

## Re-exporting after a change

```bash
ssh vps 'sudo docker exec rag_n8n sh -lc \
  "rm -rf /tmp/wfexport && mkdir -p /tmp/wfexport && \
   n8n export:workflow --all --separate --pretty --output=/tmp/wfexport"'
# then stream out, extract, and re-slug into workflows/ (see git history for the one-liner)
```

Exports are credential-free — n8n stores only credential *references* (id/name), never
secrets. The one exception is a hardcoded backend token in `library-backfill.json`,
which is redacted here (see below).

## Re-importing (e.g. onto a fresh n8n)

```bash
sudo docker cp <file>.json rag_n8n:/tmp/wf.json
sudo docker exec rag_n8n n8n import:workflow --input=/tmp/wf.json
```
Then reconnect credentials in the n8n UI and re-activate.

## Production workflows

| File | Active | Trigger | Purpose |
|------|--------|---------|---------|
| `rag-query.json` | ✅ | webhook `/rag-query` | The orchestrator. Per-chat Qdrant retrieval + gated Drive lookup, intent check, hallucination guard, and the **glm-4.6 "Generate Answer"** prompt (Mermaid / comparison-DSS / idss-options answer shaping). The crown jewels. |
| `drive-lookup.json` | ✅ | sub-workflow | On-demand Drive retrieval: LLM term extraction → recursive PalmCo folder scope → Drive search → read top file via Read Document, with a `drive_read_cache` read-through cache. |
| `read-document.json` | ✅ | sub-workflow | Shared multi-format reader. Routes by extension: PDF/image via Gemini 2.5 (OpenRouter), Office via Gotenberg→PDF, text/xlsx natively. Returns `{text}` Markdown. |
| `drive-list.json` | ✅ | webhook `/drive-list` | Lists non-trashed files in the PalmCo Drive folder. Backend Drive-sync calls this. |
| `drive-download.json` | ✅ | webhook `/drive-download` | Downloads a Drive file by id, returns bytes for inline PDF preview. |
| `rag-read.json` | ✅ | webhook `/rag-read` | Stateless per-chat reader (multipart file → Read Document → `{text}`). No chunk/embed. |
| `library-backfill.json` | ⛔ | manual | Bulk-indexes the PalmCo Drive tree into the backend Qdrant library. Inactive; run manually. **Contains a redacted `x-index-token`** (`__REDACTED_LIBRARY_INDEX_TOKEN__`) — restore the real backend `/library` index token before running. |

## `_archive/`

Legacy and throwaway workflows (probes, superseded versions, scratch). Kept for history;
none are wired into prod. Safe to ignore.
