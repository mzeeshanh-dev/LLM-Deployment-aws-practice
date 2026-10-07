# GreenBot

GreenBot has a Flask chat interface, a FastAPI integration endpoint, and Qwen3 through Ollama. The model is selected with `OLLAMA_MODEL` in `.env` (default `qwen3:0.6b`). Both chat endpoints send `think: false` to Ollama. The API has two modes:

| Mode | When used | Factual source |
| --- | --- | --- |
| `raw` | No context is supplied, or explicitly requested | Ollama's general model response |
| `grounded` | Context is supplied, or explicitly requested | Only supplied context chunks |

`mode: "auto"` selects `grounded` when `context` is nonempty and `raw` otherwise. The web UI does this automatically. Grounded mode keeps the strict 2–3 short line rule and refuses unsupported numbers. Raw mode is a normal conversational model response and is **not** source grounded. Your future Qdrant RAG layer should retrieve trusted chunks and call the same endpoint with `mode: "grounded"`; GreenBot itself does not query Qdrant.

Configuration lives in `.env`: `OLLAMA_MODEL` changes the model, `OLLAMA_BASE_URL` changes the inference server, `OLLAMA_NUM_CTX` sets the context window, `OLLAMA_NUM_PREDICT` and `OLLAMA_RAW_NUM_PREDICT` cap grounded and raw output, `OLLAMA_KEEP_ALIVE` controls model unloading, `OLLAMA_TIMEOUT_SECONDS` sets the API timeout, and `API_KEY` protects chat requests. Changing the provider URL or model does not change RAG/business logic.

## Run locally

From PowerShell in this project folder:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Replace API_KEY in .env with a long random secret.
docker compose up -d --build
docker compose exec ollama ollama pull qwen3:0.6b
Invoke-RestMethod http://127.0.0.1:8000/health
```

Open <http://127.0.0.1:8000/>. The app code is mounted read-only into the container, so later Python/UI edits need `docker compose restart app` and do not require a new image build. To change models, edit `OLLAMA_MODEL` in `.env`, pull the new tag in the Ollama container, then run `docker compose up -d`.

## Web interface

- **General chat:** Leave the source workspace empty and ask any question. The UI uses raw mode.
- **Source grounded:** Paste a trusted passage or upload a CSV, text PDF, or TXT file. The UI uses grounded mode automatically. Clear context to return to general chat.
- **Clear chat:** Removes the conversation from the page and browser storage. **Clear context:** Removes the saved source and switches back to general chat.
- The first chat request asks for the `API_KEY` from `.env`. It is kept in browser session storage.

Example source passage:

```text
Test farm record: Green Plot is in Sahiwal district. Its crop is wheat. The last recorded irrigation was on 1 October 2026.
```

Ask: `Which crop is in Green Plot?` Expected response: `The crop is wheat.` Ask: `How much fertilizer should I apply?` The grounded answer should say that the source lacks the required dose, rather than inventing one. This sample is fictional test data.

**CSV/PDF handling:** Files are read in the browser. PDF.js extracts text from up to 200 pages. Image-only pages use browser OCR (English and Urdu, maximum 10 pages); the OCR library and language files download on first use, so the browser needs internet access. OCR text may contain errors, especially numbers and doses: verify it before relying on advice. Embedded crop photographs are not visually interpreted. A broken font encoding found in some PDFs is repaired when detected. CSV rows are converted into `column: value` facts. Extracted text (up to 750,000 characters) is stored in this browser's `localStorage`, never as a server-side file. For each grounded question, the browser selects up to five matching passages (3,000 characters total) and sends those passages to the API. The server must receive those selected passages to generate a response. The source can be overwritten with a new file or pasted text and removed with **Clear context**. Files are limited to 10 MB. Browser passage selection is a lightweight convenience, not a replacement for your Qdrant retrieval pipeline. If no passage matches, the UI asks for a closer question or source instead of sending an empty context.

For the supplied test PDFs, reupload after this update: `advisory-ADV-24021-8.pdf` has three scanned pages and needs OCR; ask `Which crop is mentioned in the advisory?`. `zero to one.pdf` uses a broken embedded text encoding, which the browser now repairs; ask `What does the preface say about Zero to One?`. These are document extraction checks, not a guarantee that the small model will answer every paraphrased question. Ask using terms present in the PDF until Qdrant semantic retrieval is connected.

## Integration API

FastAPI documentation is at `/docs`. The endpoint is `POST /v1/chat`. Send JSON with `Content-Type: application/json` and `Authorization: Bearer <API_KEY>` when `API_KEY` is set.

| Request field | Type | Meaning |
| --- | --- | --- |
| `question` | string, required | Current user question, 1–1,000 characters |
| `mode` | `auto`, `grounded`, `raw` | Default `auto`; explicit `grounded` with empty context returns a limitation |
| `context` | array of `{text, source_id?}` | Up to five trusted chunks; each `text` up to 3,000 characters, combined text up to 3,000 |
| `history` | array of `{role, content}` | Up to six prior `user`/`assistant` turns for raw mode; ignored in grounded mode |
| `language` | `auto`, `english`, `urdu`, `roman_urdu` | Default `auto` |

`source_id` (maximum 100 characters) is accepted for your own traceability but is not given to Qwen or shown to the user. Do not put Qdrant scores, instructions, or secrets in `text`; only trusted factual passages belong there. `mode: "raw"` with nonempty `context` is rejected with HTTP 422 so a caller cannot silently discard its source.

**Grounded request from a Qdrant retrieval service:**

```bash
API_KEY=$(sed -n 's/^API_KEY=//p' .env)
curl -X POST http://127.0.0.1:8000/v1/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"mode":"grounded","question":"Where is Green Plot?","context":[{"text":"Farm record: Green Plot is in Sahiwal district.","source_id":"qdrant-point-123"}]}'
```

Response:

```json
{"answer":"Green Plot is in Sahiwal district.","status":"answered","mode":"grounded"}
```

**General chat request:**

```bash
API_KEY=$(sed -n 's/^API_KEY=//p' .env)
curl -X POST http://127.0.0.1:8000/v1/chat \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"mode":"raw","question":"What can you help me with?","context":[]}'
```

The response always has `answer`, `status` (`answered` or `insufficient_context`), and the effective `mode` (`raw` or `grounded`). Invalid JSON/schema returns HTTP 422, missing/wrong key returns HTTP 401, and an unavailable Ollama server returns HTTP 503. The API does not retain chat history; send prior turns yourself in `history` for raw mode.

For streaming, send the same POST JSON and authorization header to `/v1/chat/stream`. It returns Server-Sent Events: `delta` contains `{"text":"..."}` and `done` contains `{"status":"answered","mode":"raw"}`; errors arrive as an `error` event with `detail`. Raw mode streams Ollama tokens as generated. Grounded mode sends its answer after full generation and validation so unsupported advice is never shown as partial output. Streaming improves time to first visible text; it does not reduce total CPU generation time.

## VPS deployment

For Ubuntu with Docker Compose installed, copy the project to the server, then run from that project directory (the current EC2 deployment uses `~/LLM-Deployment-aws-practice`):

```bash
cd ~/LLM-Deployment-aws-practice
cp -n .env.example .env
sed -i "s/^API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env
chmod 600 .env
sudo docker compose up -d --build
sudo docker compose exec ollama ollama pull qwen3:0.6b
```

Compose binds the app on `127.0.0.1:8000`; use a reverse proxy for public access. The current EC2 deployment uses Nginx on port 80. Public use should move to HTTPS before sending an API key over the internet. On a `t3.small`, keep one model loaded and one Uvicorn worker; low RAM and burstable CPU can make first requests slow. The server needs more disk space before future full image rebuilds.

## Tests

```powershell
python -m pip install -e ".[test]"
python -m pytest -q
node --test tests/source-utils.test.mjs
```

The grounded prompt is in `greenbot/prompts.py`. Grounding checks and prompting reduce unsupported output but cannot mathematically guarantee factual correctness; review operational agricultural advice before acting on it.

The browser PDF extractor bundles PDF.js, and the interface uses Lucide-style SVG icons. Their licenses are in `greenbot/static/vendor/`.
