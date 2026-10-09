"""sentences_300.csv의 문장만 교수님께 보낼 PDF(학습문장_300_검토용.pdf)로 만든다.

한글 발음 칸은 넣지 않는다(검증되지 않은 근사 표기라서).
HTML을 만든 뒤 Google Chrome의 인쇄 기능으로 PDF를 만든다.

    python3 make_professor_pdf.py
"""
import csv
import html
import re
import subprocess
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "sentences_300.csv"
HTML_OUT = HERE / "학습문장_300_검토용.html"
PDF_OUT = HERE / "학습문장_300_검토용.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

AUTHOR = "아랍어과 정찬민"
DATE = "2026년 10월"

ARABIC_RUN = re.compile(r"[؀-ۿ]+(?:[ .…]+[؀-ۿ]+)*")


def esc(text):
    return html.escape(text, quote=True)


def mixed(text):
    return ARABIC_RUN.sub(lambda m: f'<bdi dir="rtl" lang="ar" class="arin">{m.group(0)}</bdi>', esc(text))


def ar_cell(a, b):
    return (f'<td class="ar" dir="rtl" lang="ar"><p><span class="ab">A</span>{esc(a)}</p>'
            f'<p><span class="ab">B</span>{esc(b)}</p></td>')


def item(row):
    return (
        '<tbody class="item">'
        f'<tr><td class="id">{row["id"]}<br><span class="day">{row["전체일차"]}일차</span></td>'
        f'<td class="ko"><p>A. {esc(row["한국어_A"])}</p><p>B. {esc(row["한국어_B"])}</p></td>'
        f'{ar_cell(row["푸스하_A"], row["푸스하_B"])}'
        f'{ar_cell(row["이집트_A"], row["이집트_B"])}'
        f'{ar_cell(row["요르단_A"], row["요르단_B"])}</tr>'
        '</tbody>'
    )


def main():
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    units = {}
    for r in rows:
        units.setdefault(r["단원"], []).append(r)
    levels = Counter(r["난이도"] for r in rows)

    index = "".join(
        f'<tr><td>{u}</td><td>{esc(rs[0]["단원명"])}</td><td>{esc(rs[0]["난이도"])}</td>'
        f'<td>{rs[0]["전체일차"]}–{rs[-1]["전체일차"]}일</td><td>{rs[0]["id"]}–{rs[-1]["id"]}</td>'
        f'<td class="key">{mixed(rs[0]["단원대표표현"])}</td></tr>'
        for u, rs in units.items()
    )
    sections = "".join(
        f'<section class="unit"><h2>{u}단원 · {esc(rs[0]["단원명"])}</h2>'
        '<table class="items"><colgroup><col class="c-id"><col class="c-ko"><col class="c-ar">'
        '<col class="c-ar"><col class="c-ar"></colgroup>'
        '<thead><tr><th>ID</th><th>한국어</th><th>푸스하</th><th>이집트</th><th>요르단</th></tr></thead>'
        + "".join(item(r) for r in rs) + '</table></section>'
        for u, rs in units.items()
    )
    page = (TEMPLATE.replace("{{INDEX}}", index).replace("{{SECTIONS}}", sections)
            .replace("{{AUTHOR}}", AUTHOR).replace("{{DATE}}", DATE)
            .replace("{{N}}", str(len(rows)))
            .replace("{{L1}}", str(levels["초급"])).replace("{{L2}}", str(levels["초중급"]))
            .replace("{{L3}}", str(levels["중급"])))
    HTML_OUT.write_text(page, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={PDF_OUT}", HTML_OUT.as_uri()],
                   check=True, capture_output=True)
    print(f"PDF 생성: {PDF_OUT}")


TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>푸스하·방언 대조 학습 문장 300</title>
<style>
  @page { size: A4 landscape; margin: 11mm 10mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #1f1d1a; font: 9.5pt/1.5 "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; word-break: keep-all; }
  .ar, .arin { font-family: "Geeza Pro", "Noto Naskh Arabic", "Al Nile", serif; }
  .cover { page-break-after: always; padding: 4mm 10mm 0; }
  .cover h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -0.02em; }
  .cover .sub { font-size: 12pt; color: #3b5bdb; margin: 0 0 4pt; }
  .cover .meta { color: #6b665e; margin: 0 0 6pt; }
  .cover h3 { font-size: 11pt; margin: 9pt 0 3pt; border-bottom: 1.5px solid #1f1d1a; padding-bottom: 2pt; }
  .cover ul { margin: 2pt 0; padding-left: 16pt; }
  .cover li { margin: 2pt 0; }
  .facts { border-collapse: collapse; margin-top: 4pt; }
  .facts td { border: 1px solid #ddd8ce; padding: 3pt 8pt; }
  .facts td:first-child { color: #6b665e; background: #f6f4ef; }
  .index { page-break-after: always; padding: 4mm 6mm 0; }
  .index h3 { font-size: 13pt; margin: 0 0 6pt; }
  .index table { width: 100%; border-collapse: collapse; }
  .index th, .index td { border-bottom: 1px solid #e4e0d8; padding: 4pt 6pt; text-align: left; }
  .index th { color: #6b665e; font-weight: 600; }
  .key { font-size: 9pt; }
  .unit { page-break-before: always; }
  .unit:first-of-type { page-break-before: auto; }
  h2 { font-size: 13pt; margin: 0 0 5pt; }
  h2 small { font-size: 9pt; color: #6b665e; font-weight: 400; margin-left: 6pt; }
  table.items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .c-id { width: 7%; } .c-ko { width: 21%; } .c-ar { width: 24%; }
  table.items thead th { background: #f6f4ef; border: 1px solid #ddd8ce; padding: 3pt 6pt; font-weight: 600; }
  thead { display: table-header-group; }
  tbody.item { break-inside: avoid; page-break-inside: avoid; }
  tbody.item td { border-left: 1px solid #ddd8ce; border-right: 1px solid #ddd8ce; vertical-align: top; padding: 4pt 6pt; }
  tbody.item tr:last-child td { border-bottom: 1px solid #ddd8ce; }
  tbody.item tr:first-child td { border-top: 1px solid #ddd8ce; }
  td.id { font-weight: 700; text-align: center; }
  .day { font-weight: 400; color: #6b665e; font-size: 8pt; }
  td p { margin: 0 0 2pt; }
  td.ar { font-size: 12.5pt; line-height: 1.7; text-align: right; }
  .ab { display: inline-block; font: 600 7.5pt "Apple SD Gothic Neo", sans-serif; color: #8a8478;
    border: 1px solid #ccc6ba; border-radius: 3px; padding: 0 3px; margin-left: 5px; vertical-align: 2px; }
  td.diff { font-size: 8.5pt; color: #4a463f; background: #faf9f5; }
  .arin { font-size: 10pt; }
  .memo { color: #9a4f0a; }
</style>
</head>
<body>
{{SECTIONS}}
</body>
</html>
"""

if __name__ == "__main__":
    main()
