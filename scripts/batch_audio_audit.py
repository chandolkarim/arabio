"""Screen remaining files locally in timed batches; all differences require verification."""
import hashlib
import json
import time
import wave

import mlx_whisper
import numpy as np
from scipy.signal import resample_poly
from arabic_audio_text import compare
from transcribe_audio_audit import ROOT, MODEL, OUT


def wav_sha256(name):
    return hashlib.sha256((ROOT / 'samples/generation/wav' / (name + '.wav')).read_bytes()).hexdigest()


def is_current(name):
    """A transcript counts only if it was made from the WAV that is on disk now."""
    path = OUT / (name + '.json')
    return path.exists() and json.loads(path.read_text()).get('sha256') == wav_sha256(name)


def run(batch):
    pieces, spans = [], []
    offset = 0
    for row in batch:
        path = ROOT / 'samples/generation/wav' / (row['name'] + '.wav')
        with wave.open(str(path)) as w:
            audio = resample_poly(np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768, 2, 3)
        spans.append((offset / 16000, (offset + len(audio)) / 16000, row))
        pieces.extend([audio, np.zeros(12800, dtype=np.float32)])
        offset += len(audio) + 12800
    result = mlx_whisper.transcribe(np.concatenate(pieces), path_or_hf_repo=MODEL,
        language='ar', verbose=None, temperature=0, condition_on_previous_text=False,
        word_timestamps=True, hallucination_silence_threshold=1)
    words = [word for seg in result['segments'] for word in seg.get('words', [])]
    for start, end, row in spans:
        selected = [w for w in words if start - .05 <= (w['start'] + w['end']) / 2 < end + .4]
        transcript = ''.join(w['word'] for w in selected).strip()
        match, factor = compare(row['text'], transcript)
        record = dict(row, sha256=wav_sha256(row['name']), model=MODEL,
            mode='batch_screen', transcript=transcript, match=round(match, 3),
            recognized_length_factor=round(factor, 2),
            words=selected, batch_start=start, batch_end=end)
        target = OUT / (row['name'] + '.json')
        temp = target.with_suffix('.tmp')
        temp.write_text(json.dumps(record, ensure_ascii=False, indent=2))
        temp.replace(target)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = json.loads((ROOT/'samples/quality-audit/acoustic.json').read_text())
    batch, seconds, done = [], 0, 0
    start = time.monotonic()
    for row in rows:
        if is_current(row['name']):
            done += 1
            continue
        length = row['duration'] + .8
        if batch and seconds + length > 27:
            run(batch)
            done += len(batch)
            print(f'{done}/{len(rows)} screened; elapsed {time.monotonic()-start:.0f}s', flush=True)
            batch, seconds = [], 0
        batch.append(row)
        seconds += length
    if batch:
        run(batch)
    print('Finished screening all', len(rows), 'files', flush=True)


if __name__ == '__main__':
    main()
