# Kokoro TTS sidecar — Japanese G2P via misaki[ja] / pyopenjtalk (needs native build).
FROM python:3.12-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        curl \
        espeak-ng \
        git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        espeak-ng \
        libgomp1 \
        mecab \
        libmecab2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local/lib/ /usr/local/lib/
COPY --from=builder /usr/local/bin/ /usr/local/bin/

# Japanese G2P (misaki/fugashi) needs UniDic MeCab dictionary at runtime.
RUN python -m unidic download \
    && python -c "import pathlib, site; p=pathlib.Path(site.getsitepackages()[0])/'unidic/dicdir/mecabrc'; assert p.is_file(), p"

COPY app.py .

RUN mkdir -p /models \
    && curl -fsSL -o /models/kokoro-v1.0.onnx \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
    && curl -fsSL -o /models/voices-v1.0.bin \
        https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
    && curl -fsSL -o /models/config.json \
        https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/raw/main/config.json

ENV KOKORO_MODEL_PATH=/models/kokoro-v1.0.onnx
ENV KOKORO_VOICES_PATH=/models/voices-v1.0.bin
ENV KOKORO_VOCAB_CONFIG=/models/config.json
ENV PORT=8880

EXPOSE 8880

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8880/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8880"]