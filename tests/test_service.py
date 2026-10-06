import asyncio

import httpx

from greenbot.config import Settings
from greenbot.schemas import ChatRequest, ContextChunk
from greenbot.service import OllamaWriter, valid_answer


def test_empty_context_never_calls_model():
    def handler(request):
        raise AssertionError("Ollama must not be called")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await OllamaWriter(client, Settings(_env_file=None)).generate(ChatRequest(question="What dose?"))

    result = asyncio.run(run())
    assert result.status == "insufficient_context"


def test_context_and_configuration_sent_to_ollama():
    observed = {}

    def handler(request):
        observed.update(__import__("json").loads(request.content))
        return httpx.Response(200, json={"message": {"content": "The source says the field is in Punjab."}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            writer = OllamaWriter(client, Settings(_env_file=None, ollama_model="qwen3:1.7b"))
            return await writer.generate(ChatRequest(question="Where is the field?", context=[ContextChunk(text="The field is in Punjab.")]))

    result = asyncio.run(run())
    assert result.status == "answered"
    assert observed["model"] == "qwen3:1.7b"
    assert observed["think"] is False
    assert observed["options"]["temperature"] == 0
    assert "The field is in Punjab." in observed["messages"][1]["content"]


def test_unsupported_number_falls_back():
    def handler(request):
        return httpx.Response(200, json={"message": {"content": "Apply 50 kg fertilizer."}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await OllamaWriter(client, Settings(_env_file=None)).generate(ChatRequest(question="What fertilizer dose?", context=[ContextChunk(text="Fertilizer timing was not documented.")]))

    assert asyncio.run(run()).status == "insufficient_context"


def test_answer_limits():
    assert not valid_answer("one\ntwo\nthree\nfour", "source")
    assert not valid_answer("Use 20 ml.", "Use 10 ml.")
    assert valid_answer("The field is in Punjab.", "The field is in Punjab.")
