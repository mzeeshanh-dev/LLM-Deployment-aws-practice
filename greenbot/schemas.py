from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ContextChunk(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    source_id: str | None = Field(default=None, max_length=100)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("context text cannot be blank")
        return value.strip()


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    context: list[ContextChunk] = Field(default_factory=list, max_length=5)
    language: Literal["auto", "english", "urdu", "roman_urdu"] = "auto"
    mode: Literal["auto", "grounded", "raw"] = "auto"
    history: list["ChatTurn"] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def context_budget(self):
        if sum(len(chunk.text) for chunk in self.context) > 3000:
            raise ValueError("combined context must be at most 3000 characters")
        if self.mode == "raw" and self.context:
            raise ValueError("raw mode cannot include context; use grounded or auto")
        return self

    @field_validator("question")
    @classmethod
    def question_nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("question cannot be blank")
        return value.strip()


class ChatResponse(BaseModel):
    answer: str
    status: Literal["answered", "insufficient_context"]
    mode: Literal["grounded", "raw"]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def content_nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("history content cannot be blank")
        return value.strip()


ChatRequest.model_rebuild()
