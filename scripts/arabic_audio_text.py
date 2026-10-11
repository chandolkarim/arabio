"""Comparison normalization, including digits versus spoken Arabic number spellings."""
import re
from difflib import SequenceMatcher

# One place for every comparison threshold. Screening is looser on purpose so that
# borderline batch results get an individual pass before the report decides.
SCREEN_MATCH, SCREEN_LENGTH = .72, 1.4
CONTENT_MATCH, CONTENT_LENGTH = .7, 1.5

ONES = {1:['واحد','واحدة'],2:['اثنان','اثنين','اتنين','تنين'],3:['ثلاثة','تلاتة'],
        4:['أربعة','اربعة'],5:['خمسة'],6:['ستة'],7:['سبعة'],8:['ثمانية','تمانية'],9:['تسعة']}
TENS = {20:['عشرون','عشرين'],30:['ثلاثون','ثلاثين','تلاتين'],40:['أربعون','أربعين'],
        50:['خمسون','خمسين'],60:['ستون','ستين'],70:['سبعون','سبعين'],
        80:['ثمانون','ثمانين','تمانين'],90:['تسعون','تسعين']}
FIXED = {'خمسة عشر':15,'خمستعش':15,'خمسطعش':15,'خمستاشر':15,
         'مئتين وخمسين':250,'مائتين وخمسين':250,'ميتين وخمسين':250,
         'مئة':100,'مائة':100,'مية':100,'ميتين':200,'مئتين':200,
         'ثلاثمائة':300,'تلتمية':300,'عشرة':10,'عشر':10}


def letters(text):
    """Strip marks, unify letter variants and digits, and keep Arabic words separated by spaces."""
    text = re.sub('[ً-ٰٟـ]', '', text)
    text = text.translate(str.maketrans('أإآىؤئ٠١٢٣٤٥٦٧٨٩', 'ااايوي0123456789'))
    return ' '.join(re.findall('[ء-ي0-9]+', text))


def _number_forms():
    values = {letters(name): value for value, names in ONES.items() for name in names}
    for tens, names in TENS.items():
        for name in names:
            values[letters(name)] = tens
            for one, alternatives in ONES.items():
                for first in alternatives:
                    values[letters(first + ' و' + name)] = tens + one
    values.update({letters(k): v for k, v in FIXED.items()})
    # Every spelling and the digits collapse to one canonical spelling per value. Keeping a
    # word (not a digit) keeps string lengths comparable, so one misheard letter stays small.
    canonical = {}
    for form, value in values.items():
        canonical.setdefault(value, form.replace(' ', ''))
    forms = {form: canonical[value] for form, value in values.items()}
    forms.update({str(value): word for value, word in canonical.items()})
    # Whole words only, with an optional proclitic (و، ب، ل، ال، لل) kept in front:
    # بميتين → بمئتينوخمسين, but أهمية is left alone.
    alternation = '|'.join(re.escape(f) for f in sorted(forms, key=len, reverse=True))
    return forms, re.compile(rf'(?<!\S)(ال|لل|[وبل]|)({alternation})(?!\S)')


FORMS, NUMBER = _number_forms()


def normalize(text):
    return NUMBER.sub(lambda m: m.group(1) + FORMS[m.group(2)], letters(text)).replace(' ', '')


def compare(expected, actual):
    """Return (similarity, recognized-length factor) between source text and a transcript."""
    a, b = normalize(expected), normalize(actual)
    return SequenceMatcher(None, a, b, autojunk=False).ratio(), len(b) / max(len(a), 1)
