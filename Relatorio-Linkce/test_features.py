import unittest

import main


class FeatureTests(unittest.TestCase):
    def test_permission_matrix_exposes_new_operations(self):
        gestor = main.permissoes_para("gestor")
        apoio = main.permissoes_para("apoio")
        tecnico = main.permissoes_para("tecnico")
        self.assertTrue(gestor["baixar_backup"])
        self.assertTrue(gestor["gerenciar_empresas"])
        self.assertTrue(apoio["consultar_auditoria"])
        self.assertFalse(tecnico["baixar_backup"])

    def test_default_tenant_is_stable(self):
        user = {"id": "user", "app_metadata": {}}
        self.assertEqual(main.empresa_id_do_usuario(user), main.DEFAULT_EMPRESA_ID)

    def test_operational_routes_are_registered(self):
        paths = {route.path for route in main.app.routes}
        for path in ("/devel", "/api/permissoes", "/api/backup",
                     "/api/empresas", "/api/saude",
                     "/api/relatorios/{relatorio_id}/reprocessar"):
            self.assertIn(path, paths)


if __name__ == "__main__":
    unittest.main()
