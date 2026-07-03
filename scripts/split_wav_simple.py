import wave
import os
import math

input_path = "public/audio/slides/m1-l1/01.wav"
output_dir = "public/audio/slides/m1-l1"
num_splits = 5

def split_wav():
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        return

    try:
        with wave.open(input_path, 'rb') as src:
            params = src.getparams()
            total_frames = src.getnframes()
            frames_per_split = math.ceil(total_frames / num_splits)
            
            print(f"Total frames: {total_frames}, Splitting into {num_splits} parts (~{frames_per_split} frames each)")

            for i in range(num_splits):
                out_filename = f"{i+1:02d}.wav"
                out_path = os.path.join(output_dir, out_filename)
                
                with wave.open(out_path, 'wb') as dst:
                    dst.setparams(params)
                    data = src.readframes(frames_per_split)
                    dst.writeframes(data)
                
                print(f"Generated: {out_path}")
                
    except Exception as e:
        print(f"Error splitting wav: {e}")

if __name__ == "__main__":
    split_wav()
