# GreenBot

Flask serves the chat interface. FastAPI exposes `POST /v1/chat` and `/docs`. Ollama runs Qwen3 for **wording only**. Your trusted RAG service retrieves Qdrant chunks and sends their text in `context`; this app does not query Qdrant, invent knowledge, or accept a chat history as a factual source.

## Local Docker (PowerShell)

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Edit API_KEY in .env to a long random secret; change OLLAMA_MODEL there to upgrade later.
docker compose up -d --build
docker compose exec ollama ollama pull qwen3:1.7b
docker compose ps
Invoke-RestMethod http://localhost:8000/health
```

Open <http://localhost:8000>. Paste a trusted source passage in the left panel. On the first request, enter the `API_KEY` from `.env`. The key is held in browser session storage. For a model change, edit `OLLAMA_MODEL` in `.env`, run `docker compose exec ollama ollama pull <model-tag>`, then `docker compose up -d`.

API example (PowerShell):

```powershell
$key = (Get-Content .env | Where-Object { $_ -like 'API_KEY=*' }) -replace '^API_KEY=', ''
$body = @{ question = 'Where is the field?'; context = @(@{ text = 'The field is in Punjab.'; source_id = 'qdrant-point-123' }) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:8000/v1/chat -Method Post -Headers @{ Authorization = "Bearer $key" } -ContentType 'application/json' -Body $body
```

The response shape is `{"answer":"...","status":"answered"}` or `status: "insufficient_context"`. Empty context returns the limitation without loading Ollama. Requests support `language: "auto" | "english" | "urdu" | "roman_urdu"`. Up to five chunks and 3,000 combined context characters are accepted. `source_id` is accepted for your traceability but never shown to the model or user.

## VPS (Ubuntu, Docker and Compose already installed)

From PowerShell in this project directory, copy the project and connect:

```powershell
scp -r . ubuntu@YOUR_VPS_IP:~/greenbot
ssh ubuntu@YOUR_VPS_IP
```

On the VPS, run:

```bash
cd ~/greenbot
cp -n .env.example .env
sed -i "s/^API_KEY=.*/API_KEY=$(openssl rand -hex 32)/" .env
docker compose up -d --build
docker compose exec ollama ollama pull qwen3:1.7b
docker compose ps
curl -f http://127.0.0.1:8000/health
```

The Compose port binds only to `127.0.0.1`. Put a TLS reverse proxy with authentication/rate limiting in front of port 8000 before exposing it publicly, or use an SSH tunnel for testing: `ssh -L 8000:127.0.0.1:8000 ubuntu@YOUR_VPS_IP`. Set `API_KEY` for all API requests. Do not publish Ollama's port.

For a **t3.small** (2 GiB RAM), use a 4 GiB swap file before starting Docker if you must use that instance:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

Qwen3:1.7b's default Ollama artifact is about 1.4 GB on disk; runtime memory and the OS need more. A t3.small can swap heavily or run out of memory, and sustained CPU inference consumes burst credits. A t3.medium or larger is the more practical starting point. Keep one Uvicorn worker and one loaded Ollama model on small hosts. The API can scale separately from Ollama on larger infrastructure by changing `OLLAMA_BASE_URL`.

## Development and tests

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[test]"
pytest -q
# If Ollama is installed locally, set OLLAMA_BASE_URL=http://localhost:11434 in .env
uvicorn greenbot.main:app --reload
```

The system prompt is in `greenbot/prompts.py`. Generation uses no thinking output, temperature 0, a short output cap, and a 2,048 token context window. Validation rejects long outputs and numbers absent from source text. Prompting and this guard reduce unsupported claims, but no generative model can provide a formal guarantee of factual grounding; use a human review step for operational agriculture decisions.
