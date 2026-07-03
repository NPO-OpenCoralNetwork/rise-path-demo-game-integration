"""
Rise Path Kokoro TTS sidecar.

Contract: POST /tts/synthesize
See doc/ai-curriculum-spec/09_content_types_tts.md §3.2
"""

from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
import tempfile
import time
from typing import Literal

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Rise Path Kokoro TTS", version="1.0.0")

_kokoro = None
_g2p_ja = None
_started_at = time.time()

MODEL_PATH = os.environ.get("KOKORO_MODEL_PATH", "/models/kokoro-v1.0.onnx")
VOICES_PATH = os.environ.get("KOKORO_VOICES_PATH", "/models/voices-v1.0.bin")
VOCAB_CONFIG = os.environ.get("KOKORO_VOCAB_CONFIG", "/models/config.json")
PORT = int(os.environ.get("PORT", "8880"))


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voice_id: str = "jf_alpha"
    lang_code: str = "j"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    output_format: Literal["wav", "mp3"] = "mp3"


class SynthesizeResponse(BaseModel):
    audio_base64: str
    duration_seconds: float
    content_type: str
    cached: bool = False
    engine: str = "kokoro-82m-onnx"


def _load_kokoro():
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    from kokoro_onnx import Kokoro

    vocab = VOCAB_CONFIG if os.path.isfile(VOCAB_CONFIG) else None
    _kokoro = Kokoro(MODEL_PATH, VOICES_PATH, vocab_config=vocab)
    return _kokoro


def _load_g2p_ja():
    global _g2p_ja
    if _g2p_ja is not None:
        return _g2p_ja
    from misaki import ja

    _g2p_ja = ja.JAG2P()
    return _g2p_ja


def _kokoro_lang(lang_code: str) -> str:
    return {"a": "en-us", "b": "en-gb"}.get(lang_code, "en-us")


def _synthesize_wav(text: str, voice_id: str, lang_code: str, speed: float):
    kokoro = _load_kokoro()
    if lang_code == "j":
        g2p = _load_g2p_ja()
        phonemes, _ = g2p(text)
        return kokoro.create(phonemes, voice=voice_id, speed=speed, is_phonemes=True)
    return kokoro.create(
        text,
        voice=voice_id,
        speed=speed,
        lang=_kokoro_lang(lang_code),
    )


def _wav_to_mp3(wav_bytes: bytes) -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found; required for output_format=mp3")

    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "in.wav")
        mp3_path = os.path.join(tmp, "out.mp3")
        with open(wav_path, "wb") as handle:
            handle.write(wav_bytes)
        proc = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                wav_path,
                "-codec:a",
                "libmp3lame",
                "-qscale:a",
                "2",
                mp3_path,
            ],
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.decode("utf-8", errors="replace") or "ffmpeg failed")
        with open(mp3_path, "rb") as handle:
            return handle.read()


def _encode_audio(samples, sample_rate: int, output_format: str) -> tuple[bytes, str]:
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV")
    wav_bytes = buffer.getvalue()
    if output_format == "wav":
        return wav_bytes, "audio/wav"
    return _wav_to_mp3(wav_bytes), "audio/mpeg"


@app.get("/health")
def health():
    models_ready = os.path.isfile(MODEL_PATH) and os.path.isfile(VOICES_PATH)
    return {
        "status": "ok" if models_ready else "degraded",
        "engine": "kokoro-82m-onnx",
        "uptime_sec": round(time.time() - _started_at, 1),
        "models_ready": models_ready,
    }


@app.post("/tts/synthesize", response_model=SynthesizeResponse)
def synthesize(request: SynthesizeRequest):
    if not os.path.isfile(MODEL_PATH) or not os.path.isfile(VOICES_PATH):
        raise HTTPException(
            status_code=503,
            detail="Kokoro model files missing. Mount /models or set KOKORO_MODEL_PATH.",
        )

    try:
        samples, sample_rate = _synthesize_wav(
            request.text,
            request.voice_id,
            request.lang_code,
            request.speed,
        )
        audio_bytes, content_type = _encode_audio(samples, sample_rate, request.output_format)
        duration_seconds = float(len(samples) / sample_rate) if sample_rate else 0.0
        return SynthesizeResponse(
            audio_base64=base64.b64encode(audio_bytes).decode("ascii"),
            duration_seconds=round(duration_seconds, 2),
            content_type=content_type,
            cached=False,
        )
    except Exception as exc:  # noqa: BLE001 — surface synthesis failures to client
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)