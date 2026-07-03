# Kokoro TTS Sidecar

Rise Path TTS service wrapping [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx).

## Local run

```bash
cd deploy/kokoro-tts
pip install -r requirements.txt
# Download models (or use Docker build which fetches them)
uvicorn app:app --host 0.0.0.0 --port 8880
```

## Docker

```bash
docker build -t rise-path-kokoro-tts deploy/kokoro-tts
docker run --rm -p 8880:8880 rise-path-kokoro-tts
curl http://127.0.0.1:8880/health
```

## API

- `GET /health`
- `POST /tts/synthesize` — see `doc/ai-curriculum-spec/09_content_types_tts.md`

Integrated in `deploy/risepath-vm/docker-compose.yml` as service `kokoro-tts`.