"""sentences_300.csv를 웹 앱이 읽는 web/data/sentences.json으로 바꾼다.

web/audio/ 폴더에 음성 파일이 있으면 자동으로 연결한다.
파일 이름 규칙: {id}_{fusha|egypt|jordan}_{A|B}.m4a, .mp3 또는 .wav

    python3 build_data.py
"""
import csv
import hashlib
import json
import re
from dialect_notes import split_notes

TAG = re.compile(r"\s*\(?\s*(?:ID\d+\s*)?(?:\d+단원\s*(?:복습|미리 보기|핵심)|단원 핵심|복습)\s*\)?")
INTERNAL = ("예시", "바꿔도 됨", "화폐", "구조 복습")
REWRITE = {}
GRAMMAR = re.compile(r"부정|진행|미래|명령|수동|분사|강조|어순|발음|소유|목적어|접미|접두|의문|조건|가정")


def load_rewrite():
    if not TIPS.exists():
        return {}
    return {r["원래 설명"]: r["알아두면 좋은 점"] for r in csv.DictReader(TIPS.open(encoding="utf-8-sig"))}


def tips(notes):
    """'알아두면 좋은 점'만 남긴다. 단어 대응(푸스하 → 방언)은 화면의 표현 비교·단어 뜻 보기와 겹쳐서 뺀다.

    남기는 것: 발음(ق는 ء, ث→t, 한글 발음), 문법·어순, 관용 설명, 문화·쓰임처럼 설명이 붙은 줄.
    """
    out = []
    for note in notes:
        text = TAG.sub("", note)
        text = re.sub(r"\(\s*공통\s*,\s*", "(", text)
        text = re.sub(r",\s*공통\s*\)", ")", text)
        text = re.sub(r"\(\s*(?:구어 )?공통[^)]*\)", "", text).replace("()", "").strip()
        text = re.sub(r"[,\s]+$", "", text)
        if text.count("(") > text.count(")"):
            text += ")"  # 태그를 지우다 닫는 괄호까지 지운 경우
        if not text or text.startswith("ID") or any(word in text for word in INTERNAL):
            continue
        rest = text.split(":", 1)[1] if ":" in text else text
        rest = re.sub(r"이집트|요르단", "", rest)
        label = text.split(":", 1)[0]
        if ":" in text and not GRAMMAR.search(label) and not re.search(r"[가-힣A-Za-z]", rest):
            continue  # 라벨 + 아랍어 대응뿐인 줄
        text = REWRITE.get(text, text)
        if text and text not in out:
            out.append(text)
    return out
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "sentences_300.csv"
WORDS = HERE / "word_gloss.csv"  # 단어를 누르면 보이는 뜻 (발음 기호를 뺀 형태 → 한국어 뜻)
TIPS = HERE / "tips_rewrite.csv"  # 원래 설명 → 형태가 보이게 고쳐 쓴 설명 (빈칸이면 뺌)
PHRASES = HERE / "phrase_gloss.csv"  # 숙어·굳은 표현은 한 덩어리로 뜻을 보여 준다
WEB = HERE / "web"
OUT = WEB / "data" / "sentences.json"
AUDIO = WEB / "audio"

VARIANTS = {"fusha": "푸스하", "egypt": "이집트", "jordan": "요르단"}


def options(row, ko_name):
    return [o for o in row[f"오답_{ko_name}"].split(" | ") if o]


def main():
    REWRITE.update(load_rewrite())
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
            "tipsByDialect": {d: tips(split_notes(r["바뀐부분"]).get(d, []) + split_notes(r["메모"]).get(d, []))
                              for d in ("egypt", "jordan")},
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
            item[key]['audioRevision'] = {
                side: hashlib.sha256((AUDIO / name).read_bytes()).hexdigest()[:12]
                for side, name in item[key]['audio'].items()
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
    words = ({r["단어"]: r["뜻"] for r in csv.DictReader(WORDS.open(encoding="utf-8-sig")) if r["뜻"]}
             if WORDS.exists() else {})
    phrases = ({r["표현"]: r["뜻"] for r in csv.DictReader(PHRASES.open(encoding="utf-8-sig")) if r["뜻"]}
               if PHRASES.exists() else {})
    temporary.write_text(json.dumps({"units": units, "sentences": sentences, "words": words, "phrases": phrases},
                                    ensure_ascii=False),
                         encoding="utf-8")
    temporary.replace(OUT)
    with_audio = sum(1 for s in sentences for k in VARIANTS if s[k]["audio"])
    print(f"데이터 생성: {OUT} · 문장 {len(sentences)}개 · 단원 {len(units)}개 · 음성 연결 {with_audio}건")


if __name__ == "__main__":
    main()
