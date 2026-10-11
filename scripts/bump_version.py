"""배포 전에 실행: index.html의 ?v= 캐시 버전과 web/version.txt를 같은 새 값으로 바꾼다.

    python3 scripts/bump_version.py            # 시각 기반 버전 (예: 20261011-2215)
    python3 scripts/bump_version.py my-tag     # 직접 지정

앱은 version.txt와 자기 ?v= 값이 다르면 새 페이지를 받아 오므로, 둘이 항상 같아야 한다.
"""
import re
import sys
from datetime import datetime
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
tag = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y%m%d-%H%M")
index = WEB / "index.html"
index.write_text(re.sub(r"\?v=[\w.-]+", f"?v={tag}", index.read_text()))
(WEB / "version.txt").write_text(tag + "\n")
print("version:", tag)
