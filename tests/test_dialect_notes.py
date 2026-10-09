import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dialect_notes import split_notes

class DialectNotesTest(unittest.TestCase):
    def test_example(self):
        notes = split_notes('잘: جيدًا → كويس / منيح · 아주: جدًا → أوي / كتير · صباح الخير의 대답은 세 가지 모두 صباح النور')
        self.assertEqual(notes['egypt'][:2], ['잘: جيدًا → كويس', '아주: جدًا → أوي'])
        self.assertEqual(notes['jordan'][:2], ['잘: جيدًا → منيح', '아주: جدًا → كتير'])
        self.assertEqual(notes['egypt'][2], notes['jordan'][2])

    def test_country_specific_and_nested(self):
        notes = split_notes('공부하다: 이집트는 ذاكر · 명사 부정: ليس → مش(이집트 무쉬 / 요르단 미쉬)')
        self.assertEqual(notes['jordan'], ['명사 부정: ليس → مش(미쉬)'])
        self.assertEqual(notes['egypt'][-1], '명사 부정: ليس → مش(무쉬)')

    def test_all_sentences(self):
        sentences = json.loads(Path('web/data/sentences.json').read_text())['sentences']
        self.assertEqual(len(sentences), 300)
        for sentence in sentences:
            for key, source in [('notesByDialect', 'note'), ('memosByDialect', 'memo')]:
                self.assertEqual(sentence[key], split_notes(sentence[source]))
                for dialect, other in [('egypt', '요르단'), ('jordan', '이집트')]:
                    for note in sentence[key][dialect]:
                        self.assertNotIn(other, note, sentence['id'])
                        self.assertNotIn(' / ', note, sentence['id'])
            for dialect in ['egypt', 'jordan']:
                self.assertTrue(sentence['notesByDialect'][dialect], sentence['id'])

if __name__ == '__main__': unittest.main()
