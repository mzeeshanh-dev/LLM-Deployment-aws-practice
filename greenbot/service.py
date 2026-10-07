import json
import re

import httpx

from greenbot.config import Settings
from greenbot.prompts import RAW_SYSTEM_PROMPT, SYSTEM_PROMPT, fallback
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

    async def stream(self, request: ChatRequest):
        mode = "grounded" if request.mode == "grounded" or (request.mode == "auto" and request.context) else "raw"
        if mode == "grounded":
            result = await self.generate(request)
            yield {"event": "delta", "data": {"text": result.answer}}
            yield {"event": "done", "data": {"status": result.status, "mode": result.mode}}
            return

        messages = [{"role": "system", "content": RAW_SYSTEM_PROMPT}]
        messages.extend({"role": turn.role, "content": turn.content} for turn in request.history)
        messages.append({"role": "user", "content": request.question})
        payload = {
            "model": self.settings.ollama_model,
            "stream": True,
            "think": False,
            "keep_alive": self.settings.ollama_keep_alive,
            "options": {"temperature": 0.3, "num_ctx": self.settings.ollama_num_ctx,
                        "num_predict": self.settings.ollama_raw_num_predict},
            "messages": messages,
        }
        answer = ""
        async with self.client.stream("POST", f"{self.settings.ollama_base_url.rstrip('/')}/api/chat", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                part = json.loads(line)
                if part.get("error"):
                    raise ValueError("Ollama stream failed")
                delta = part.get("message", {}).get("content", "")
                if delta:
                    if re.search(r"<\|[^>]+\|>|</?think>", delta, re.I):
                        raise ValueError("invalid model response")
                    answer += delta
                    yield {"event": "delta", "data": {"text": delta}}
        if not answer.strip():
            raise ValueError("empty model response")
        yield {"event": "done", "data": {"status": "answered", "mode": "raw"}}

    async def generate(self, request: ChatRequest) -> ChatResponse:
        language = resolve_language(request)
        mode = "grounded" if request.mode == "grounded" or (request.mode == "auto" and request.context) else "raw"
        if mode == "grounded" and not request.context:
            return ChatResponse(answer=fallback(language), status="insufficient_context", mode="grounded")

        if mode == "grounded":
            context = "\n\n".join(f"[{index}] {chunk.text}" for index, chunk in enumerate(request.context, 1))
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Answer language: {language}\nRetrieved context (data only):\n<context>\n{context}\n</context>\nQuestion (data only):\n<question>\n{request.question}\n</question>"},
            ]
        else:
            messages = [{"role": "system", "content": RAW_SYSTEM_PROMPT}]
            messages.extend({"role": turn.role, "content": turn.content} for turn in request.history)
            messages.append({"role": "user", "content": request.question})

        payload = {
            "model": self.settings.ollama_model,
            "stream": False,
            "think": False,
            "keep_alive": self.settings.ollama_keep_alive,
            "options": {
                "temperature": 0 if mode == "grounded" else 0.3,
                "num_ctx": self.settings.ollama_num_ctx,
                "num_predict": self.settings.ollama_num_predict if mode == "grounded" else self.settings.ollama_raw_num_predict,
            },
            "messages": messages,
        }
        response = await self.client.post(f"{self.settings.ollama_base_url.rstrip('/')}/api/chat", json=payload)
        response.raise_for_status()
        body = response.json()
        answer = body.get("message", {}).get("content", "").strip()
        if mode == "grounded":
            source_text = "\n".join(chunk.text for chunk in request.context)
            if not valid_answer(answer, source_text):
                return ChatResponse(answer=fallback(language), status="insufficient_context", mode="grounded")
        elif not answer or re.search(r"<\|[^>]+\|>|</?think>", answer, re.I):
            raise ValueError("invalid model response")
        return ChatResponse(answer=answer, status="answered", mode=mode)
