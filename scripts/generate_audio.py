"""Generate resumable Sawtak audio without exposing the API key to the web app."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
import hashlib
import fcntl
import json
from pathlib import Path
import threading
import time
import urllib.request
import urllib.error
import uuid
import wave

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'samples' / 'generation'
AUDIO = STATE / 'wav'
VOICES = {
    'fusha': '381f4457-7cc6-5fb4-84e5-f9dd14ac93d3',
    'egypt': '3e88109c-4903-5b09-a250-b43305ea3b82',
    'jordan': '3a2e57a2-5730-5102-8208-77b1997354b8',
}
BASE = 'https://api.sawtakarabi.ai/v1/'
LOCK = threading.Lock()
STOP = threading.Event()
NEXT_START = 0.0


def load_key():
    path = Path.home() / '.config/arabio/sawtak.env'
    for line in path.read_text().splitlines():
        if line.startswith('SAWTAK_API_KEY='):
            key = line.split('=', 1)[1].strip().strip('\"\'')
            if key:
                return key
    raise RuntimeError('Missing local API key')


def request(key, route, payload=None, idem=None):
    headers = {'Authorization': 'Bearer ' + key, 'User-Agent': 'Arabio/1.0'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    if idem:
        headers['Idempotency-Key'] = idem
    return urllib.request.urlopen(urllib.request.Request(
        BASE + route, data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers), timeout=45)


def get(key, route):
    for attempt in range(4):
        try:
            with request(key, route) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504, 520, 521, 522, 524) or attempt == 3:
                raise
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            if attempt == 3:
                raise
        time.sleep(2 ** attempt)


def save(path, data):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def speech_request(key, payload, idem):
    # Retry transport/gateway failures only with the exact same idempotency key.
    # Any accepted duplicate is rejected by the server instead of billed twice.
    for attempt in range(4):
        try:
            return request(key, 'audio/speech', payload, idem)
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504, 520, 521, 522, 524) or attempt == 3:
                raise
            delay = max(2 ** (attempt + 1), int(error.headers.get('Retry-After', '0')))
        except (ConnectionError, TimeoutError, urllib.error.URLError):
            if attempt == 3:
                raise
            delay = 2 ** (attempt + 1)
        time.sleep(min(delay, 60))


def valid_wav(path):
    try:
        with wave.open(str(path)) as w:
            frames = w.getnframes()
            return (w.getnchannels() == 1 and w.getsampwidth() == 2 and
                    w.getframerate() == 24000 and frames > 0 and
                    len(w.readframes(frames)) == frames * 2)
    except (OSError, EOFError, wave.Error):
        return False


def jobs():
    data = json.loads((ROOT / 'web/data/sentences.json').read_text())
    return [(f'{s["id"]}_{v}_{side}', v, s[v][side])
            for s in data['sentences'] for v in VOICES for side in 'AB']


def generate(key, job):
    global NEXT_START
    name, variant, text = job
    output = AUDIO / (name + '.wav')
    partial = STATE / (name + '.partial.wav')
    state_path = STATE / (name + '.json')
    payload = dict(model='arabic-tts-1', voice=VOICES[variant], input=text,
                   response_format='pcm', sample_rate=24000, enhance_pronunciation=False)
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state['fingerprint'] != fingerprint:
            raise RuntimeError(name + ': source changed; manual review required')
        if state.get('complete') and valid_wav(output):
            return 'cached'
        # Never resubmit accepted or uncertain work; reconcile first.
        if state.get('submitted'):
            operation = get(key, 'operations/' + state['operation_id']) if state.get('operation_id') else {}
            if operation.get('outcome') == 'completed' and valid_wav(partial):
                with wave.open(str(partial)) as w:
                    received = w.getnframes() * 2
                if operation.get('completion_bytes') == received:
                    partial.replace(output)
                    state.update(complete=True, operation=operation, seconds=received / 48000)
                    state.pop('error', None)
                    save(state_path, state)
                    return 'recovered'
            if not state.get('operation_id') and time.time() - state_path.stat().st_mtime < 23 * 3600:
                # A response header was never received. Reuse the original key within
                # its retention window; the server will reject any accepted duplicate.
                pass
            elif operation.get('state') == 'terminal' and operation.get('charged_micros') == 0 and operation.get('outcome') != 'completed':
                state.pop('operation_id', None)
            else:
                raise RuntimeError(name + ': previous request needs reconciliation (no duplicate submitted)')
    else:
        if output.exists():
            raise RuntimeError(name + ': untracked audio exists')
        state = dict(fingerprint=fingerprint, idempotency_key=str(uuid.uuid4()), payload=payload)
    with LOCK:
        delay = max(0, NEXT_START - time.monotonic())
        NEXT_START = max(NEXT_START, time.monotonic()) + 1.15
    if STOP.wait(delay):
        return 'stopped'
    state['submitted'] = True
    save(state_path, state)
    received = 0
    try:
        with speech_request(key, payload, state['idempotency_key']) as response:
            state['operation_id'] = response.headers.get('x-request-id')
            save(state_path, state)
            if response.headers.get('content-type', '').split(';')[0] != 'audio/pcm':
                raise RuntimeError('Unexpected audio format')
            if response.headers.get('x-sample-rate') != '24000' or response.headers.get('x-channels') != '1':
                raise RuntimeError('Unexpected sample format')
            with wave.open(str(partial), 'wb') as w:
                w.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                pending = b''
                while chunk := response.read(65536):
                    pending += chunk
                    size = len(pending) - len(pending) % 2
                    w.writeframes(pending[:size])
                    received += size
                    pending = pending[size:]
            if pending or not received or not state['operation_id']:
                raise RuntimeError('Incomplete audio')
        for _ in range(10):
            operation = get(key, 'operations/' + state['operation_id'])
            if operation.get('state') == 'terminal':
                break
            time.sleep(2)
        state['operation'] = operation
        save(state_path, state)
        if operation.get('outcome') != 'completed' or operation.get('completion_bytes') != received:
            raise RuntimeError('Completion unconfirmed')
        if not valid_wav(partial):
            raise RuntimeError('Invalid WAV')
        partial.replace(output)
        state.update(complete=True, seconds=received / 48000)
        state.pop('error', None)
        save(state_path, state)
        return 'created'
    except Exception as error:
        STOP.set()
        if isinstance(error, urllib.error.HTTPError) and error.code == 409:
            detail = json.load(error)
            if detail.get('operation_id'):
                state['operation_id'] = detail['operation_id']
        state['error'] = ('HTTP ' + str(error.code)) if isinstance(error, urllib.error.HTTPError) else type(error).__name__ + ': ' + str(error)
        save(state_path, state)
        raise RuntimeError(name + ': ' + state['error']) from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    AUDIO.mkdir(parents=True, exist_ok=True)
    # One writer per generation directory; parallel workers run inside this process.
    run_lock = (STATE / 'run.lock').open('a')
    try:
        fcntl.flock(run_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('Another generator is already running')
    key = load_key()
    account = get(key, 'me')
    queue = jobs()[:args.limit]
    missing = [j for j in queue if not (STATE / (j[0] + '.json')).exists()]
    estimate = Decimal(sum(len(j[2]) for j in missing)) * Decimal('0.00005')
    balance = Decimal(str(account['balance_usd']))
    print(f'Balance ${balance}; new generation estimate ${estimate}; files {len(queue)}', flush=True)
    if balance < estimate:
        raise SystemExit('Insufficient existing credit; no generation started')
    errors = []
    counts = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(generate, key, j): j[0] for j in queue}
        for done, future in enumerate(as_completed(futures), 1):
            try:
                result = future.result()
                counts[result] = counts.get(result, 0) + 1
            except Exception as error:
                STOP.set()
                errors.append(str(error))
                print('ERROR', str(error), flush=True)
            if done % 10 == 0 or done == len(queue):
                print(f'{done}/{len(queue)} {counts}', flush=True)
    print('Remaining balance', get(key, 'me')['balance_usd'], flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
