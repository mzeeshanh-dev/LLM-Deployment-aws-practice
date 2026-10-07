from contextlib import asynccontextmanager
from secrets import compare_digest

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
import json
from fastapi.middleware.wsgi import WSGIMiddleware
from flask import Flask, render_template

from greenbot.config import settings
from greenbot.schemas import ChatRequest, ChatResponse
from greenbot.service import OllamaWriter


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=settings.ollama_timeout_seconds) as client:
        app.state.writer = OllamaWriter(client, settings)
        yield


app = FastAPI(title="GreenBot API", version="1.0.0", lifespan=lifespan)
web = Flask(__name__)


@web.get("/")
def index():
    return render_template("index.html")


def authenticate(authorization: str | None = Header(default=None)) -> None:
    if settings.api_key and not compare_digest(authorization or "", f"Bearer {settings.api_key}"):
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/chat", response_model=ChatResponse, dependencies=[Depends(authenticate)])
async def chat(payload: ChatRequest, request: Request):
    try:
        return await request.app.state.writer.generate(payload)
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=503, detail="Model service is unavailable") from exc


@app.post("/v1/chat/stream", dependencies=[Depends(authenticate)])
async def chat_stream(payload: ChatRequest, request: Request):
    async def events():
        try:
            async for item in request.app.state.writer.stream(payload):
                yield f"event: {item['event']}\ndata: {json.dumps(item['data'], ensure_ascii=False)}\n\n"
        except (httpx.HTTPError, ValueError, KeyError):
            yield 'event: error\ndata: {"detail":"Model service is unavailable"}\n\n'

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


app.mount("/", WSGIMiddleware(web))
