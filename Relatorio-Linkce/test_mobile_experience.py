import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
WORKER = (ROOT / "static" / "sw.js").read_text(encoding="utf-8")
MANIFEST = (ROOT / "static" / "manifest.json").read_text(encoding="utf-8")


class MobileExperienceTests(unittest.TestCase):
    def test_pwa_installation_metadata_is_available(self):
        self.assertIn('rel="manifest"', INDEX)
        self.assertIn('beforeinstallprompt', INDEX)
        self.assertIn('"display": "standalone"', MANIFEST)
        self.assertIn('"start_url": "/tecnico"', MANIFEST)

    def test_offline_queue_is_scoped_by_user_and_company(self):
        self.assertIn("fila.createIndex('user_id'", WORKER)
        self.assertIn("fila.createIndex('empresa_id'", WORKER)
        self.assertIn('function pertenceSessao', WORKER)
        self.assertIn("'X-Empresa-ID':empresaId", WORKER)

    def test_drafts_are_isolated_per_user_and_company(self):
        self.assertIn("return 'campo_rascunho:' + empresa + ':' + usuario", INDEX)
        self.assertNotIn("const DRAFT_KEY = 'linkce_rascunho'", INDEX)

    def test_photos_are_persisted_and_acknowledged_individually(self):
        self.assertIn("client_photo_id", WORKER)
        self.assertIn("status: 'salva_no_aparelho'", WORKER)
        self.assertIn("await removerFotoOffline(foto.id)", WORKER)
        self.assertIn("type:'FOTO_SYNC_STATUS'", WORKER)

    def test_saved_report_is_not_recreated_while_photos_retry(self):
        self.assertIn("_relatorioId:relatorioId", WORKER)
        self.assertIn("if (!relatorioId)", WORKER)
        self.assertIn("type:'VINCULAR_RELATORIO'", INDEX)

    def test_manual_retry_and_visible_status_exist(self):
        self.assertIn("sincronizarAgora(true)", INDEX)
        self.assertIn("force:forcar === true", INDEX)
        self.assertIn("id=\"syncMessage\"", INDEX)
        self.assertIn("estadoFilaOffline", INDEX)


if __name__ == "__main__":
    unittest.main()
