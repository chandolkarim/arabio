"""Split the source's Egypt / Jordan notes at build time, preserving shared notes.

The CSV convention puts Egypt first. Explicit exceptions preserve prose that
cannot safely be separated by the slash convention.
"""
import re

NAMES = {"egypt": "이집트", "jordan": "요르단"}
OVERRIDES = {
    "숫자: ث→t (اتنين / تنين, تلاتة)": ("숫자: ث→t (اتنين, تلاتة)", "숫자: ث→t (تنين, تلاتة)"),
    "저기: هناك → هناك(히낙 / 후닉)": ("저기: هناك → هناك(히낙)", "저기: هناك → هناك(후닉)"),
    "과거 부정: 이집트는 ما...ش(ما شفتكش), 요르단 예문은 ما(ما شفتك). 요르단에서도 지역·화자·문맥에 따라 ما...ش를 씀": (
        "과거 부정: ما...ش(ما شفتكش)",
        "과거 부정: 이 예문은 ما(ما شفتك). 지역·화자·문맥에 따라 ما...ش도 씀"),
    "명사 부정: ليس → مش(이집트 무쉬 / 요르단 미쉬)": ("명사 부정: ليس → مش(무쉬)", "명사 부정: ليس → مش(미쉬)"),
    "지내다(머물다): قاعد(공통, ق 발음은 이집트 ء / 요르단 ء 또는 g)": ("지내다(머물다): قاعد(ق 발음은 ء)", "지내다(머물다): قاعد(ق 발음은 ء 또는 g)"),
    "사투리: 이집트는 العامية, 요르단은 اللهجة": ("사투리: العامية", "사투리: اللهجة"),
    "알다: 이집트는 تعرف(بـ 없이 흔함), 요르단은 بتعرف": ("알다: تعرف(بـ 없이 흔함)", "알다: بتعرف"),
    "옆: بجانب → جنب(이집트 감브 / 요르단 잔브)": ("옆: بجانب → جنب(감브)", "옆: بجانب → جنب(잔브)"),
    "참고: 이집트 커피 주문은 سادة(무설탕)·مظبوط(보통)·زيادة(많이), 아랍 커피(قهوة عربية)는 보통 설탕 없이 마심": (
        "커피 주문: سادة(무설탕)·مظبوط(보통)·زيادة(많이)", "아랍 커피(قهوة عربية)는 보통 설탕 없이 마심"),
    "구경하다: تفرّج(공통, ج는 이집트 g)": ("구경하다: تفرّج(ج는 g)", "구경하다: تفرّج"),
    "새: جديد(이집트 기디드)": ("새: جديد(기디드)", "새: جديد"),
    "운전하다: قاد → ساق(공통, ق는 이집트 ء)": ("운전하다: قاد → ساق(ق는 ء)", "운전하다: قاد → ساق"),
    "금요일: الجمعة(이집트 곰아)": ("금요일: الجمعة(곰아)", "금요일: الجمعة"),
    "군대: الجيش(이집트 게쉬)": ("군대: الجيش(게쉬)", "군대: الجيش"),
    "배: بطن(이집트는 여성, 요르단은 남성 취급이 흔함)": ("배: بطن(여성 취급이 흔함)", "배: بطن(남성 취급이 흔함)"),
    "실업: البطالة(공통, 이집트 비딸라)": ("실업: البطالة(비딸라)", "실업: البطالة"),
    "숫자 뒤 화폐는 방언별로(이집트 파운드 / 요르단 디나르)": ("숫자 뒤 화폐: 이집트 파운드", "숫자 뒤 화폐: 요르단 디나르"),
    "도시 이름은 방언별로(카이로 / 암만) 바꿔도 됨": ("도시 이름은 카이로로 바꿔도 됨", "도시 이름은 암만으로 바꿔도 됨"),
    "ID026의 بقالـ / صارلـ 구조 복습": ("ID026의 بقالـ 구조 복습", "ID026의 صارلـ 구조 복습"),
    "네 생각에: في رأيك → إنت شايف / برأيك('내 생각에'는 في رأيي / برأيي)(12단원 미리 보기)": (
        "네 생각에: في رأيك → إنت شايف(12단원 미리 보기)",
        "네 생각에: في رأيك → برأيك('내 생각에'는 في رأيي → برأيي)(12단원 미리 보기)"),
    "속다(당하다): 관용 اتضحك عليه / انضحك عليه(수동형 اتـ / انـ, 8단원 복습)": (
        "속다(당하다): 관용 اتضحك عليه(수동형 اتـ, 8단원 복습)",
        "속다(당하다): 관용 انضحك عليه(수동형 انـ, 8단원 복습)"),
    "제2의 고향: وطني الثاني → بلدي التانية / بلدي التاني(이집트는 بلد를 여성으로도 씀)": (
        "제2의 고향: وطني الثاني → بلدي التانية(بلد를 여성으로도 씀)", "제2의 고향: وطني الثاني → بلدي التاني"),
}


def top_level_slash(text):
    depth = 0
    for i, char in enumerate(text):
        if char == "(": depth += 1
        elif char == ")": depth -= 1
        elif char == "/" and depth == 0 and text[i-1:i] == " " and text[i+1:i+2] == " ":
            return i
    return None


def for_dialect(text, dialect):
    if text in OVERRIDES:
        return OVERRIDES[text][dialect == "jordan"]
    other = NAMES["jordan" if dialect == "egypt" else "egypt"]
    split = top_level_slash(text)
    if split is not None:
        left, right = text[:split].strip(), text[split+1:].strip()
        # Preserve the meaning/Fusha label shared by both dialect branches.
        marker = left.rfind("→")
        if marker < 0: marker = left.find(":")
        prefix = left[:marker+1] + " " if marker >= 0 else ""
        body = left[marker+1:].strip() if marker >= 0 else left
        chosen = body if dialect == "egypt" else right
        # Opposite-only parenthetical annotations do not describe this branch.
        chosen = re.sub(r"\([^()]*" + other + r"[^()]*\)", "", chosen)
        if other in chosen:
            raise ValueError(f"Unresolved dialect annotation: {text}")
        return prefix + chosen
    # A note explicitly scoped to one country is not shared with the other.
    if other in text:
        if NAMES[dialect] in text:
            raise ValueError(f"Mixed prose needs an explicit split: {text}")
        return None
    return text


def split_notes(text):
    return {dialect: [result for part in text.split(" · ") if part.strip()
                      if (result := for_dialect(part.strip(), dialect))]
            for dialect in NAMES}
