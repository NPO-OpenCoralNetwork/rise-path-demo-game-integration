
import os
import struct

def get_mp3_duration(file_path):
    try:
        size = os.path.getsize(file_path)
        with open(file_path, 'rb') as f:
            f.seek(0, os.SEEK_END)
            end = f.tell()
            f.seek(0, os.SEEK_SET)
            
            # ID3 tag skipping (simple heuristic)
            if f.read(3) == b'ID3':
                f.seek(6)
                size_bytes = f.read(4)
                # Synchsafe integer handling
                tag_size = (size_bytes[0] << 21) | (size_bytes[1] << 14) | (size_bytes[2] << 7) | size_bytes[3]
                f.seek(tag_size + 10)
            else:
                f.seek(0)
            
            # Read first MP3 frame header to get bitrate
            # This is a very rough estimation assuming constant bitrate (CBR)
            # A proper MP3 parser is complex; for now, we'll assume standard 44.1kHz 128kbps or similar if we can't find header
            # Or better, we can just return a placeholder if we can't easily parse.
            # Actually, standard MP3 file duration = file_size * 8 / bitrate
            pass
            
    except Exception as e:
        return 0

# Since parsing MP3 manually is error-prone without a lib, 
# and we are in a dev environment, let's try to use 'ffmpeg' via shell if available,
# or just rely on 'afinfo' (macOS) since the user is on Darwin.

import subprocess

def get_duration_afinfo(file_path):
    try:
        result = subprocess.run(['afinfo', file_path], capture_output=True, text=True)
        for line in result.stdout.splitlines():
            if 'duration' in line:
                # Line format: "duration: 10.812 sec at 44100 bytes/sec"
                parts = line.split()
                for i, part in enumerate(parts):
                    if part == 'duration:':
                         return float(parts[i+1])
        return 0
    except Exception:
        return 0

files = [
    "public/audio/slides/m1-l1/01.mp3",
    "public/audio/slides/m1-l1/02.mp3",
    "public/audio/slides/m1-l1/03.mp3",
    "public/audio/slides/m1-l1/04.mp3",
    "public/audio/slides/m1-l1/05.mp3"
]

print("Durations:")
for f in files:
    d = get_duration_afinfo(f)
    print(f"{d:.2f}")
