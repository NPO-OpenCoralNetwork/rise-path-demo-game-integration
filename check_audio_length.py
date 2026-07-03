
import wave
import contextlib

files = [
    "public/vice/開発環境について.wav",
    "public/vice/vscode使い方.wav",
    "public/vice/vscodeとai.wav"
]

for fname in files:
    try:
        with contextlib.closing(wave.open(fname, 'r')) as f:
            frames = f.getnframes()
            rate = f.getframerate()
            duration = frames / float(rate)
            print(f"{fname}: {duration:.2f} seconds")
    except Exception as e:
        print(f"{fname}: Error - {e}")
