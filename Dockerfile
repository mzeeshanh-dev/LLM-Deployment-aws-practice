FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY greenbot ./greenbot
RUN pip install --no-cache-dir .
RUN useradd --create-home appuser
USER appuser
EXPOSE 8000
CMD ["uvicorn", "greenbot.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
