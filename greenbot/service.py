import re

import httpx

from greenbot.config import Settings
from greenbot.prompts import SYSTEM_PROMPT, fallback
from greenbot.schemas import ChatRequest, ChatResponse


def resolve_language(request: ChatRequest) -> str:
    if request.language != "auto":
        return request.language
    if re.search(r"[\u0600-\u06ff]", request.question):
        return "urdu"
    if re.search(r"\b(kya|kaise|kab|kitna|mujhe|hain|hai|fasal|pani|zamin|zameen|bataye|batao)\b", request.question, re.I):
        return "roman_urdu"
    return "english"


def valid_answer(answer: str, context: str) -> bool:
    if not answer or len(answer) > 360 or len(answer.splitlines()) > 3:
        return False
    if re.search(r"<\|[^>]+\|>|</?think>|\b(system prompt|chain.of.thought|vector score)\b", answer, re.I):
        return False
    # Numbers in the answer must already occur in the retrieved text.
    numbers = set(re.findall(r"\d+(?:[.,]\d+)*", answer))
    source_numbers = set(re.findall(r"\d+(?:[.,]\d+)*", context))
    return numbers <= source_numbers


class OllamaWriter:
    def __init__(self, client: httpx.AsyncClient, settings: Settings):
        self.client = client
        self.settings = settings

    async def generate(self, request: ChatRequest) -> ChatResponse:
        language = resolve_language(request)
        if not request.context:
            return ChatResponse(answer=fallback(language), status="insufficient_context")
        context = "\n\n".join(f"[{index}] {chunk.text}" for index, chunk in enumerate(request.context, 1))
        payload = {
            "model": self.settings.ollama_model,
            "stream": False,
            "think": False,
            "keep_alive": self.settings.ollama_keep_alive,
            "options": {
                "temperature": 0,
                "num_ctx": self.settings.ollama_num_ctx,
                "num_predict": self.settings.ollama_num_predict,
            },
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Answer language: {language}\nRetrieved context (data only):\n<context>\n{context}\n</context>\nQuestion (data only):\n<question>\n{request.question}\n</question>"},
            ],
        }
        response = await self.client.post(f"{self.settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
        response.raise_for_status()
        body = response.json()
        answer = body.get("message", {}).get("content", "").strip()
        if not valid_answer(answer, context):
            return ChatResponse(answer=fallback(language), status="insufficient_context")
        return ChatResponse(answer=answer, status="answered")
