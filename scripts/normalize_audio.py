"""원본 WAV의 말소리 크기를 같은 값으로 맞춰 web/audio/의 M4A를 다시 만든다.

말소리 구간(가장 큰 구간보다 25dB 이내)의 RMS를 TARGET_DB로 맞춘다. 최대 음량이
CEILING_DB를 넘으면 넘는 부분만 부드럽게 눌러 소리가 찢어지지 않게 한다.
원본 WAV는 바꾸지 않고, 기존 M4A는 처음 실행할 때 samples/audio-prenorm/에 백업한다.
끝나면 build_data.py를 다시 돌려 앱의 음성 버전(해시)을 갱신한다.
package_audio.py와 replace_audio.py도 같은 encode()를 써서 새 음성이 같은 크기로 들어간다.

    python3 scripts/normalize_audio.py            # 전체
    python3 scripts/normalize_audio.py 094_egypt_A  # 일부만
"""
import array
import audioop
import json
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'samples/generation/wav'
AUDIO = ROOT / 'web/audio'
BACKUP = ROOT / 'samples/audio-prenorm'
REPORT = ROOT / 'samples/quality-audit/loudness.json'
TARGET_DB = -20.0
CEILING_DB = -1.0
GATE_DB = -25.0


def speech_db(pcm, rate):
    """Speech level in dBFS, or None when the clip has no signal at all."""
    win = rate // 10 * 2
    levels = [audioop.rms(pcm[i:i + win], 2) for i in range(0, len(pcm) - win, win)] or [audioop.rms(pcm, 2)]
    gate = max(levels) * 10 ** (GATE_DB / 20)
    voiced = [r for r in levels if r > gate]
    if not voiced:
        return None
    return 20 * math.log10(math.sqrt(sum(r * r for r in voiced) / len(voiced)) / 32768)


def soft_limit(pcm, ceiling):
    knee = ceiling * 0.8
    samples = array.array('h', pcm)
    for i, x in enumerate(samples):
        a = abs(x)
        if a > knee:
            y = knee + (ceiling - knee) * math.tanh((a - knee) / (ceiling - knee))
            samples[i] = int(math.copysign(y, x))
    return samples.tobytes()


def encode(wav, out, workdir):
    """Write `out` (M4A) from `wav` with speech at TARGET_DB. Shared by package/replace scripts."""
    with wave.open(str(wav)) as w:
        params, pcm = w.getparams(), w.readframes(w.getnframes())
    before = speech_db(pcm, params.framerate)
    if before is None:
        raise ValueError(f'{wav.name}: silent or empty audio')
    pcm = audioop.mul(pcm, 2, 10 ** ((TARGET_DB - before) / 20))
    ceiling = 32767 * 10 ** (CEILING_DB / 20)
    limited = audioop.max(pcm, 2) > ceiling
    if limited:
        pcm = soft_limit(pcm, ceiling)
    tmp_wav = Path(workdir) / wav.name
    with wave.open(str(tmp_wav), 'wb') as w:
        w.setparams(params)
        w.writeframes(pcm)
    partial = out.with_suffix('.partial.m4a')
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', str(tmp_wav), str(partial)],
                   check=True, capture_output=True)
    tmp_wav.unlink()
    if partial.stat().st_size < 100:
        raise RuntimeError('Empty conversion: ' + wav.name)
    partial.replace(out)
    return {'name': wav.stem, 'beforeDb': round(before, 2), 'afterDb': round(speech_db(pcm, params.framerate), 2),
            'gainDb': round(TARGET_DB - before, 2), 'limited': limited}


def normalize(name, workdir):
    try:
        return encode(RAW / f'{name}.wav', AUDIO / f'{name}.m4a', workdir)
    except ValueError as error:
        return {'name': name, 'error': str(error)}


def main():
    names = sys.argv[1:] or sorted(p.stem for p in AUDIO.glob('*.m4a') if (RAW / f'{p.stem}.wav').exists())
    if not BACKUP.exists():
        BACKUP.mkdir(parents=True)
        for p in AUDIO.glob('*.m4a'):
            shutil.copy2(p, BACKUP / p.name)
    with tempfile.TemporaryDirectory() as workdir, ThreadPoolExecutor(8) as pool:
        rows = list(pool.map(lambda n: normalize(n, workdir), names))
    failed = [r for r in rows if 'error' in r]
    old = {r['name']: r for r in json.loads(REPORT.read_text())['files']} if REPORT.exists() else {}
    old.update({r['name']: r for r in rows if 'error' not in r})
    files = sorted(old.values(), key=lambda r: r['name'])
    after = [r['afterDb'] for r in files]
    REPORT.write_text(json.dumps({'targetDb': TARGET_DB, 'ceilingDb': CEILING_DB, 'files': files},
                                 ensure_ascii=False, indent=1), encoding='utf-8')
    # The app adds each file's hash as ?v=, so the data must be rebuilt or browsers keep old audio.
    subprocess.run([sys.executable, str(ROOT / 'build_data.py')], check=True)
    span = f'{min(after):.1f}~{max(after):.1f} dB' if after else '-'
    print(f'정규화 {len(rows) - len(failed)}개 · 말소리 크기 {span} · '
          f'부드럽게 누른 파일 {sum(r.get("limited", False) for r in rows)}개')
    if failed:
        print('건너뜀(무음·빈 파일, 기존 M4A 유지):', ', '.join(r['error'] for r in failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
