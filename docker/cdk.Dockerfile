# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"

RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable \
    && uv pip install pymysql

RUN groupadd --gid 1000 ketos \
    && useradd --uid 1000 --gid ketos --home-dir /app/data --create-home ketos \
    && chown -R ketos:ketos /app/data

LABEL org.opencontainers.image.title="ketos-cdk" \
      org.opencontainers.image.source="https://git.ketos.test/ketos/ketos"

USER ketos
EXPOSE 7860
CMD ["python", "-m", "ketos", "run", "--host", "0.0.0.0", "--port", "7860"]
