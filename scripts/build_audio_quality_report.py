"""Build a conservative, listenable shortlist from local recognition comparisons."""
import hashlib
import json
from pathlib import Path
from arabic_audio_text import CONTENT_LENGTH, CONTENT_MATCH, compare

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT/'web/data/audio-audit.json'


def wav_sha256(name):
    return hashlib.sha256((ROOT/'samples/generation/wav'/(name+'.wav')).read_bytes()).hexdigest()


def main():
    rows = [json.loads(p.read_text()) for p in (ROOT/'samples/quality-audit/transcripts').glob('*.json')]
    cross_path = ROOT/'samples/quality-audit/crosscheck.json'
    cross = {r['name']:r for r in json.loads(cross_path.read_text())} if cross_path.exists() else {}
    # Replaced files keep their entry (and the pre-replacement transcript) so the review page
    # can still play the new audio; replace_audio.py skips them by the `replaced` flag.
    previous = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    replaced = {r['name']:r for r in previous.get('candidates', []) if r.get('replaced')}
    candidates, stale = list(replaced.values()), []
    for row in rows:
        if row['name'] in replaced:
            continue
        # A transcript of an earlier WAV says nothing about the current audio.
        if row.get('sha256') != wav_sha256(row['name']):
            stale.append(row['name'])
            continue
        match, factor = compare(row['text'], row['transcript'])
        row['match'] = round(match,3)
        # Only isolated second-pass comparisons become content candidates.
        isolated = row.get('mode') != 'batch_screen'
        content = isolated and (match < CONTENT_MATCH or factor > CONTENT_LENGTH)
        alternate = cross.get(row['name'])
        corroborated = bool(alternate and alternate['match'] < .9 and match < .9)
        if alternate and alternate['match'] >= .9:
            content = False  # One recognizer recovered the source; do not call it a content defect.
        elif corroborated:
            content = True
        if not content and not row['flags']:
            continue
        reason = []
        if content:
            reason.append('두 인식 모델에서 원문과 차이가 잡힘 · 직접 확인 필요' if corroborated else '개별 음성 인식 결과가 원문과 다름 · 받아쓰기 오류 가능')
        if 'long_speech' in row['flags']:
            reason.append('문장 길이 대비 재생 시간이 김')
        if 'short_speech' in row['flags']:
            reason.append('문장 길이 대비 재생 시간이 짧음')
        if 'quiet' in row['flags']:
            reason.append('같은 목소리의 다른 파일보다 볼륨이 작음')
        if 'long_silence' in row['flags']:
            reason.append('앞뒤 무음이 김')
        if 'clipping' in row['flags']:
            reason.append('큰 소리가 잘릴 가능성')
        selected = {key: row[key] for key in ('name','day','variant','side','text','transcript','sha256','match','duration','flags')}
        selected.update(contentCandidate=content, reason=' / '.join(reason))
        if alternate:
            selected['alternateTranscript'] = alternate['transcript']
        selected['crossModelDifference'] = corroborated
        candidates.append(selected)
    candidates.sort(key=lambda r:(not r.get('replaced'),not r['contentCandidate'],not r['crossModelDifference'],r['match'],r['day']))
    report = dict(checked=len(rows)-len(stale), stale=len(stale),
                  contentCandidates=sum(r['contentCandidate'] and not r.get('replaced') for r in candidates),
                  replacedCount=len(replaced), candidates=candidates,
                  method='Local automatic recognition and acoustic screening; not a human pronunciation review.')
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('Screened:',report['checked'],'Content candidates:',report['contentCandidates'],'All candidates:',len(candidates),
          'Replaced:',len(replaced))
    if stale:
        print(f'{len(stale)} transcripts are older than their WAV; rerun batch_audio_audit.py:', ' '.join(sorted(stale)[:10]))
    for r in candidates[:20]:
        print(r['name'],r['day'],r['match'],r['text'],'->',r['transcript'][:140])


if __name__ == '__main__':
    main()
