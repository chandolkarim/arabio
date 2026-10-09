"""sentences_300.csv를 검수용 HTML(review.html)로 만든다.

CSV를 엑셀·텍스트 편집기로 열면 아랍어 문장 끝의 ! ؟ . 이나 숫자가
왼쪽으로 튀어 보인다. 이 페이지는 아랍어 칸을 오른쪽→왼쪽으로 보여 준다.

    python3 make_review.py
"""
import csv
import html
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "sentences_300.csv"
OUT = HERE / "review.html"

VARIANTS = [("푸스하", "fusha"), ("이집트", "egypt"), ("요르단", "jordan")]


def esc(text):
    return html.escape(text, quote=True)


ARABIC_RUN = re.compile(r"[؀-ۿ]+(?:[ .…]+[؀-ۿ]+)*")


def mixed(text):
    """한국어 설명 속 아랍어 조각을 따로 감싸 순서가 꼬이지 않게 한다."""
    return ARABIC_RUN.sub(lambda m: f'<bdi dir="rtl" lang="ar" class="arin">{m.group(0)}</bdi>', esc(text))


def ar(text):
    return f'<p class="ar" dir="rtl" lang="ar">{esc(text)}</p>'


def card(row):
    lines = []
    for name, cls in VARIANTS:
        lines.append(
            f'<div class="v {cls}"><span class="tag">{name}</span>'
            f'{ar(row[name + "_A"])}{ar(row[name + "_B"])}'
            f'<p class="pron">{esc(row[name + "_발음"])}</p></div>'
        )
    memo = f'<p class="memo">메모 · {mixed(row["메모"])}</p>' if row["메모"] else ""
    return (
        f'<article id="id{row["id"]}" data-unit="{row["단원"]}">'
        f'<header><b>ID{row["id"]}</b> · {row["단원"]}단원 {esc(row["단원명"])} · '
        f'{row["전체일차"]}일차 {row["순서"]}번 · {esc(row["난이도"])}'
        f'<span class="status">{esc(row["상태"])}</span></header>'
        f'<p class="ko">A. {esc(row["한국어_A"])}<br>B. {esc(row["한국어_B"])}</p>'
        f'<div class="grid">{"".join(lines)}</div>'
        f'<p class="diff">{mixed(row["바뀐부분"])}</p>{memo}</article>'
    )


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    units = []
    for row in rows:
        if row["단원"] not in [u for u, _ in units]:
            units.append((row["단원"], row["단원명"]))
    options = "".join(f'<option value="{u}">{u}단원 {esc(n)}</option>' for u, n in units)
    body = "".join(card(r) for r in rows)
    OUT.write_text(TEMPLATE.replace("{{OPTIONS}}", options).replace("{{BODY}}", body)
                   .replace("{{COUNT}}", str(len(rows))), encoding="utf-8")
    print(f"검수 페이지 생성: {OUT} ({len(rows)}개)")


TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>아랍어 문장 검수</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#fbfaf7; --paper:#fff; --ink:#1f1d1a; --muted:#6b665e; --line:#e4e0d8; --accent:#3b5bdb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#161513; --paper:#1e1d1b; --ink:#ece9e3; --muted:#a39d93; --line:#36332f; --accent:#8ea6ff; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.6 -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; word-break:keep-all; }
  .bar { position:sticky; top:0; z-index:1; background:var(--bg); border-bottom:1px solid var(--line);
    padding:10px 16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  main { max-width:1100px; margin:0 auto; padding:12px 16px 40px; }
  article { background:var(--paper); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  header { color:var(--muted); font-size:12px; display:flex; gap:4px; flex-wrap:wrap; }
  header b { color:var(--ink); }
  .status { margin-left:auto; color:var(--accent); }
  .ko { margin:6px 0 8px; }
  .grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  .v { border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .tag { font-size:12px; color:var(--muted); }
  .ar { font-family:"Noto Naskh Arabic", "Geeza Pro", serif; font-size:19px; line-height:1.8;
    margin:2px 0; text-align:right; unicode-bidi:isolate; }
  .pron { color:var(--muted); font-size:12px; margin:4px 0 0; }
  .hide-pron .pron { display:none; }
  .diff { font-size:13px; margin:8px 0 0; }
  .arin { font-family:"Noto Naskh Arabic", "Geeza Pro", serif; font-size:15px; }
  .memo { font-size:12px; color:var(--muted); margin:4px 0 0; }
  @media (max-width:760px) { .grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
<div class="bar">
  <b>아랍어 문장 검수 · {{COUNT}}개</b>
  <select id="unit"><option value="">전체 단원</option>{{OPTIONS}}</select>
  <label><input type="checkbox" id="pron" checked> 한글 발음 보기</label>
</div>
<main id="list">{{BODY}}</main>
<script>
  const unit = document.getElementById('unit');
  const pron = document.getElementById('pron');
  unit.addEventListener('change', () => {
    document.querySelectorAll('article').forEach(a => {
      a.hidden = unit.value !== '' && a.dataset.unit !== unit.value;
    });
  });
  pron.addEventListener('change', () => document.body.classList.toggle('hide-pron', !pron.checked));
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
