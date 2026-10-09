"""sentences_300.csv를 웹 앱이 읽는 web/data/sentences.json으로 바꾼다.

web/audio/ 폴더에 음성 파일이 있으면 자동으로 연결한다.
파일 이름 규칙: {id}_{fusha|egypt|jordan}_{A|B}.m4a, .mp3 또는 .wav

    python3 build_data.py
"""
import csv
import json
from dialect_notes import split_notes
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "sentences_300.csv"
WEB = HERE / "web"
OUT = WEB / "data" / "sentences.json"
AUDIO = WEB / "audio"

VARIANTS = {"fusha": "푸스하", "egypt": "이집트", "jordan": "요르단"}


def options(row, ko_name):
    return [o for o in row[f"오답_{ko_name}"].split(" | ") if o]


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    audio_files = {p.name for p in AUDIO.iterdir() if p.suffix in {".m4a", ".mp3", ".wav"}} if AUDIO.exists() else set()

    sentences = []
    for r in rows:
        item = {
            "id": r["id"],
            "unit": int(r["단원"]),
            "unitName": r["단원명"],
            "level": r["난이도"],
            "day": int(r["전체일차"]),
            "order": int(r["순서"]),
            "ko": {"A": r["한국어_A"], "B": r["한국어_B"]},
            "blankSide": r["빈칸_위치"],
            "koWrong": [o for o in r["오답_한국어"].split(" | ") if o],
            "note": r["바뀐부분"],
            "notesByDialect": split_notes(r["바뀐부분"]),
            "unitKey": r["단원대표표현"],
            "memo": r["메모"],
            "memosByDialect": split_notes(r["메모"]),
            "status": r["상태"],
            "gloss": json.loads(r["보기_뜻"]),
        }
        for key, ko_name in VARIANTS.items():
            item[key] = {
                "A": r[f"{ko_name}_A"],
                "B": r[f"{ko_name}_B"],
                "blank": r[f"빈칸_{ko_name}"],
                "wrong": options(r, ko_name),
                "audio": {
                    side: name for side in "AB"
                    if (name := next((f"{r['id']}_{key}_{side}.{ext}" for ext in ("m4a", "mp3", "wav")
                                      if f"{r['id']}_{key}_{side}.{ext}" in audio_files), None))
                },
            }
        sentences.append(item)

    units = []
    for s in sentences:
        if not units or units[-1]["unit"] != s["unit"]:
            units.append({"unit": s["unit"], "name": s["unitName"], "level": s["level"],
                          "key": s["unitKey"], "firstDay": s["day"], "lastDay": s["day"]})
        units[-1]["lastDay"] = s["day"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix('.json.tmp')
    temporary.write_text(json.dumps({"units": units, "sentences": sentences}, ensure_ascii=False),
                         encoding="utf-8")
    temporary.replace(OUT)
    with_audio = sum(1 for s in sentences for k in VARIANTS if s[k]["audio"])
    print(f"데이터 생성: {OUT} · 문장 {len(sentences)}개 · 단원 {len(units)}개 · 음성 연결 {with_audio}건")


if __name__ == "__main__":
    main()
