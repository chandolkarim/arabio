"""Local, resumable Arabic speech comparison; recognition differences are candidates, not proof."""
import argparse
import hashlib
import json
import re
import time
import wave
from difflib import SequenceMatcher
from pathlib import Path

import mlx_whisper
import numpy as np
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'samples/quality-audit/transcripts'
MODEL = 'mlx-community/whisper-large-v3-turbo'


def normalize(text):
    text = re.sub('[\u064b-\u065f\u0670\u0640]', '', text)
    return re.sub('[^\u0621-\u064a]', '', text.translate(str.maketrans('أإآىؤئ', 'ااايوي')))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    rows = json.loads((ROOT / 'samples/quality-audit/acoustic.json').read_text())
    # Inspect acoustic outliers and the reported day first, then cover every file.
    rows.sort(key=lambda r: (not bool(r['flags']), r['day'] != 94, -r['length_factor']))
    start = time.monotonic()
    for i, row in enumerate(rows[:args.limit], 1):
        raw = ROOT / 'samples/generation/wav' / (row['name'] + '.wav')
        fingerprint = hashlib.sha256(raw.read_bytes()).hexdigest()
        target = OUT / (row['name'] + '.json')
        if target.exists() and json.loads(target.read_text()).get('sha256') == fingerprint:
            continue
        with wave.open(str(raw)) as w:
            audio = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768
        result = mlx_whisper.transcribe(
            resample_poly(audio, 2, 3), path_or_hf_repo=MODEL, language='ar',
            verbose=None, temperature=0, condition_on_previous_text=False)
        expected, actual = normalize(row['text']), normalize(result['text'])
        ratio = SequenceMatcher(None, expected, actual, autojunk=False).ratio()
        record = dict(row, sha256=fingerprint, model=MODEL, transcript=result['text'].strip(),
                      match=round(ratio, 3), recognized_length_factor=round(len(actual) / max(len(expected), 1), 2),
                      segments=result['segments'])
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(record, ensure_ascii=False, indent=2))
        temp.replace(target)
        if row['flags'] or ratio < .65 or i % 25 == 0:
            print(f"{i}/{len(rows)} {row['name']} match={ratio:.2f} {row['text']} -> {result['text'].strip()}", flush=True)
    print('Finished in', round(time.monotonic() - start, 1), 'seconds', flush=True)


if __name__ == '__main__':
    main()
