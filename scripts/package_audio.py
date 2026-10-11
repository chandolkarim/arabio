"""Compress completed WAV files on macOS and atomically connect them to the app."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from normalize_audio import encode

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / 'web/audio'
RAW = ROOT / 'samples/generation/wav'


def package():
    count = 0
    sources = {wav.name: wav for folder in (AUDIO, RAW) for wav in folder.glob('*.wav')}
    for wav in sorted(sources.values()):
        output = AUDIO / (wav.stem + '.m4a')
        if output.exists():
            continue
        # Same speech-level normalization as the rest of the library (-20 dB).
        with tempfile.TemporaryDirectory() as workdir:
            encode(wav, output, workdir)
        count += 1
    if count:
        subprocess.run([sys.executable, str(ROOT / 'build_data.py')], check=True,
                       stdout=subprocess.DEVNULL)
        print('Compressed and connected:', len(list(AUDIO.glob('[0-9]*_[AB].m4a'))), flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--watch-pid', type=int)
    args = p.parse_args()
    while True:
        package()
        if not args.watch_pid:
            break
        try:
            os.kill(args.watch_pid, 0)
        except ProcessLookupError:
            package()
            break
        time.sleep(20)


if __name__ == '__main__':
    main()
