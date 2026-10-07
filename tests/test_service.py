import asyncio

import httpx
from pydantic import ValidationError

from greenbot.config import Settings
from greenbot.schemas import ChatRequest, ChatTurn, ContextChunk
from greenbot.service import OllamaWriter, valid_answer


def test_explicit_grounded_mode_without_context_never_calls_model():
    def handler(request):
        raise AssertionError("Ollama must not be called")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await OllamaWriter(client, Settings(_env_file=None)).generate(ChatRequest(question="What dose?", mode="grounded"))

    result = asyncio.run(run())
    assert result.status == "insufficient_context"
    assert result.mode == "grounded"


def test_empty_context_uses_raw_ollama_and_history():
    observed = {}

    def handler(request):
        observed.update(__import__("json").loads(request.content))
        return httpx.Response(200, json={"message": {"content": "Here is an answer."}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await OllamaWriter(client, Settings(_env_file=None)).generate(ChatRequest(question="Continue", history=[ChatTurn(role="user", content="Hello")]))

    result = asyncio.run(run())
    assert result.mode == "raw"
    assert result.answer == "Here is an answer."
    assert observed["messages"][-2:] == [{"role": "user", "content": "Hello"}, {"role": "user", "content": "Continue"}]
    assert observed["options"]["temperature"] == 0.3


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
    assert result.mode == "grounded"
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

    result = asyncio.run(run())
    assert result.status == "insufficient_context"
    assert result.mode == "grounded"


def test_grounded_mode_ignores_raw_history():
    observed = {}

    def handler(request):
        observed.update(__import__("json").loads(request.content))
        return httpx.Response(200, json={"message": {"content": "Punjab."}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            request = ChatRequest(question="Where?", context=[ContextChunk(text="The field is in Punjab.")], history=[ChatTurn(role="assistant", content="Secret previous answer")])
            return await OllamaWriter(client, Settings(_env_file=None)).generate(request)

    assert asyncio.run(run()).mode == "grounded"
    assert "Secret previous answer" not in str(observed["messages"])


def test_raw_mode_rejects_context():
    try:
        ChatRequest(question="Hi", mode="raw", context=[ContextChunk(text="A source")])
    except ValidationError:
        pass
    else:
        raise AssertionError("raw mode must not silently ignore context")


def test_answer_limits():
    assert not valid_answer("one\ntwo\nthree\nfour", "source")
    assert not valid_answer("Use 20 ml.", "Use 10 ml.")
    assert valid_answer("The field is in Punjab.", "The field is in Punjab.")


def test_raw_stream_disables_thinking_and_yields_deltas():
    import json
    observed = {}

    def handler(request):
        observed.update(json.loads(request.content))
        lines = [
            json.dumps({"message": {"content": "Hello"}, "done": False}),
            json.dumps({"message": {"content": " there"}, "done": False}),
            json.dumps({"done": True}),
        ]
        return httpx.Response(200, text="\n".join(lines) + "\n")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return [item async for item in OllamaWriter(client, Settings(_env_file=None)).stream(ChatRequest(question="Hi"))]

    events = asyncio.run(run())
    assert observed["think"] is False
    assert observed["stream"] is True
    assert observed["model"] == "qwen3:0.6b"
    assert events == [
        {"event": "delta", "data": {"text": "Hello"}},
        {"event": "delta", "data": {"text": " there"}},
        {"event": "done", "data": {"status": "answered", "mode": "raw"}},
    ]
