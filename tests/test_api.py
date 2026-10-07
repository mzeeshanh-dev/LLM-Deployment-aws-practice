from fastapi.testclient import TestClient

from greenbot.main import app
from greenbot.schemas import ChatResponse


def test_ui_health_and_chat_auth(monkeypatch):
    from greenbot import main

    monkeypatch.setattr(main.settings, "api_key", "test-secret")

    class FakeWriter:
        async def generate(self, payload):
            return ChatResponse(answer="The field is in Punjab.", status="answered", mode="grounded")

    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/static/style.css").status_code == 200
        assert client.get("/health").json() == {"status": "ok"}
        app.state.writer = FakeWriter()
        body = {"question": "Where is the field?", "context": [{"text": "The field is in Punjab."}]}
        assert client.post("/v1/chat", json=body).status_code == 401
        response = client.post("/v1/chat", json=body, headers={"Authorization": "Bearer test-secret"})
        assert response.status_code == 200
        assert response.json() == {"answer": "The field is in Punjab.", "status": "answered", "mode": "grounded"}
