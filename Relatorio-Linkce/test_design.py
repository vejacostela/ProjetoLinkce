"""Structural regression checks for the shared dashboard/report design."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

class Markup(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.stack = []
        self.ids = []
        self.fields = []
        self.controls = {}
        self.links = []
        self.errors = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
            self.controls[attrs['id']] = list(self.stack)
        if tag in ('input', 'textarea', 'select') and attrs.get('name'):
            self.fields.append((attrs['name'], list(self.stack)))
        if tag == 'link':
            self.links.append(attrs.get('href'))
        if tag not in VOID:
            self.stack.append((tag, attrs.get('id')))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack or self.stack[-1][0] != tag:
            self.errors.append(tag)
        else:
            self.stack.pop()

class DesignTests(unittest.TestCase):
    def test_pages_are_balanced_and_ids_unique(self):
        for file in (ROOT/'index.html', ROOT/'Relatorio-Linkce/index.html'):
            page = Markup(file.read_text())
            self.assertEqual(page.errors, [], file.name)
            self.assertEqual(page.stack, [], file.name)
            self.assertEqual([key for key, n in Counter(page.ids).items() if n > 1], [])
            self.assertIn('/panel-assets/design-system.css?v=1', page.links)

    def test_report_controls_remain_in_submission_form(self):
        page = Markup((ROOT/'Relatorio-Linkce/index.html').read_text())
        self.assertEqual(len(page.fields), 19)
        for name, ancestors in page.fields:
            self.assertIn(('form', 'formRelatorio'), ancestors, name)
        self.assertIn(('form', 'formRelatorio'), page.controls['btnSubmit'])
        for identity in ('attendanceTitle', 'photosTitle', 'materialsTitle', 'btnCamera', 'btnGaleria'):
            self.assertIn(identity, page.ids)

    def test_dashboard_actions_are_preserved(self):
        page = Markup((ROOT/'index.html').read_text())
        for identity in ('apply','reset','saveFilters','restoreFilters','exportCsv','exportFullCsv','downloadBackup','printReports','rows','map','summaryFailed','summaryPendingSend'):
            self.assertIn(identity, page.ids)

    def test_shared_theme_is_precached(self):
        worker = (ROOT/'Relatorio-Linkce/static/sw.js').read_text()
        self.assertIn("'/panel-assets/design-system.css?v=1'", worker)
        self.assertIn("url.pathname === '/panel-assets/design-system.css'", worker)
        self.assertTrue((ROOT/'static/design-system.css').is_file())

if __name__ == '__main__':
    unittest.main()
