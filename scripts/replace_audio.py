"""Regenerate the displayed content candidates, retaining originals and resumable state."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from decimal import Decimal
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import wave

import generate_audio as g
from normalize_audio import encode


def main():
    run_lock = (g.STATE/'run.lock').open('a')
    fcntl.flock(run_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    report_path = g.ROOT/'web/data/audio-audit.json'
    report = json.loads(report_path.read_text())
    names = [r['name'] for r in report['candidates'] if r['contentCandidate'] and not r.get('replaced')]
    if not names:
        print('No unreplaced content candidates', flush=True)
        return
    jobs = {job[0]:job for job in g.jobs()}
    key = g.load_key()
    estimate = Decimal(sum(len(jobs[n][2]) for n in names))*Decimal('0.00005')
    if Decimal(str(g.get(key,'me')['balance_usd'])) < estimate:
        raise RuntimeError('Insufficient existing credit')
    # A failed run resumes through this manifest, preserving the same request keys.
    marker = g.STATE/'replacement-active.json'
    if marker.exists():
        manifest = json.loads(marker.read_text())
        if manifest['names'] != names:
            raise RuntimeError('A different replacement run is pending')
        backup = Path(manifest['backup'])
    else:
        backup = g.STATE/'replacements'/datetime.now().strftime('%Y%m%d-%H%M%S-content')
        backup.mkdir(parents=True)
        for name in names:
            for p in (g.STATE/(name+'.json'),g.AUDIO/(name+'.wav')):
                shutil.copy2(p,backup/p.name)
            shutil.copy2(g.ROOT/'web/audio'/(name+'.m4a'),backup/(name+'.m4a'))
        manifest = dict(names=names,backup=str(backup),prepared=[])
        g.save(marker,manifest)
    for name in names:
        if name not in manifest['prepared']:
            for p in (g.STATE/(name+'.json'),g.AUDIO/(name+'.wav')):
                p.unlink(missing_ok=True)
            manifest['prepared'].append(name)
            g.save(marker,manifest)
    print('Replacing',len(names),'files; estimated existing credit',estimate,flush=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(g.generate,key,jobs[name]):name for name in names}
        for done,future in enumerate(as_completed(futures),1):
            name = futures[future]
            print(done,name,future.result(),flush=True)
    for row in report['candidates']:
        name = row['name']
        if name not in names:
            continue
        raw = g.AUDIO/(name+'.wav')
        with wave.open(str(raw)) as w:
            params = w.getparams()
        output = g.ROOT/'web/audio'/(name+'.m4a')
        # Same speech-level normalization as the rest of the library (-20 dB).
        # A scratch dir, not `backup`: the backup already holds the original <name>.wav.
        with tempfile.TemporaryDirectory() as workdir:
            level = encode(raw, output, workdir)
        row.update(replaced=True,sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                   replacementSeconds=params.nframes/params.framerate,
                   normalizationGainDb=level['gainDb'])
    report['replacedCount'] = sum(bool(r.get('replaced')) for r in report['candidates'])
    g.save(report_path,report)
    g.save(backup/'manifest.json',dict(manifest,complete=True))
    marker.unlink()
    subprocess.run(['python3',str(g.ROOT/'build_data.py')],check=True)
    print('Finished. Remaining existing credit:',g.get(key,'me')['balance_usd'],flush=True)


if __name__ == '__main__':
    main()
