from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ollama_model: str = "qwen3:0.6b"
    ollama_base_url: str = "http://localhost:11434"
    ollama_timeout_seconds: float = 90
    ollama_num_ctx: int = 2048
    ollama_num_predict: int = 120
    ollama_raw_num_predict: int = 180
    ollama_keep_alive: str = "15m"
    api_key: str = ""


settings = Settings()
