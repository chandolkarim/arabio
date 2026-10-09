"""Verify every app audio mapping against its source and completed operation."""
import hashlib
import json
from pathlib import Path
import wave

ROOT = Path(__file__).resolve().parents[1]


def audit():
    data = json.loads((ROOT / 'web/data/sentences.json').read_text())
    voices = {
        'fusha': '381f4457-7cc6-5fb4-84e5-f9dd14ac93d3',
        'egypt': '3e88109c-4903-5b09-a250-b43305ea3b82',
        'jordan': '3a2e57a2-5730-5102-8208-77b1997354b8',
    }
    checked = 0
    charge = 0
    seconds = 0
    missing = []
    for sentence in data['sentences']:
        for variant, voice in voices.items():
            for side in 'AB':
                name = f'{sentence["id"]}_{variant}_{side}'
                statefile = ROOT / 'samples/generation' / (name + '.json')
                if not statefile.exists():
                    missing.append(name)
                    continue
                state = json.loads(statefile.read_text())
                if not state.get('complete'):
                    missing.append(name)
                    continue
                payload = state['payload']
                assert payload['voice'] == voice, name + ': voice mismatch'
                assert payload['input'] == sentence[variant][side], name + ': text mismatch'
                assert hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest() == state['fingerprint']
                assert state['operation']['outcome'] == 'completed', name
                raw = ROOT / 'samples/generation/wav' / (name + '.wav')
                if not raw.exists():
                    raw = ROOT / 'web/audio' / (name + '.wav')
                with wave.open(str(raw)) as audio:
                    frames = audio.getnframes()
                    assert frames > 0 and audio.getframerate() == 24000 and audio.getnchannels() == 1
                    pcm = audio.readframes(frames)
                    assert len(pcm) == frames * 2 == state['operation']['completion_bytes'], name
                    seconds += frames / 24000
                filename = sentence[variant]['audio'].get(side)
                assert filename == name + '.m4a', name + ': compressed app mapping missing'
                encoded = ROOT / 'web/audio' / filename
                with encoded.open('rb') as f:
                    assert f.read(12)[4:8] == b'ftyp', name + ': invalid container'
                assert encoded.stat().st_size > 100
                charge += state['operation']['charged_micros']
                checked += 1
    report = dict(expected=1800, verified=checked, missing=len(missing),
                  charged_usd=charge / 1e6, total_audio_minutes=round(seconds / 60, 2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if missing:
        print('First missing:', ', '.join(missing[:10]))
        raise SystemExit(1)
    assert checked == 1800
    (ROOT / 'samples/generation/audit-report.txt').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    audit()
