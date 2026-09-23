import unittest

import main


class ImageSecurityTests(unittest.TestCase):
    def test_detects_supported_image_signatures(self):
        self.assertEqual(main._detectar_tipo_imagem(b"\xff\xd8\xff" + b"x" * 20), "image/jpeg")
        self.assertEqual(main._detectar_tipo_imagem(b"\x89PNG\r\n\x1a\n" + b"x" * 20), "image/png")
        self.assertEqual(main._detectar_tipo_imagem(b"RIFF1234WEBP" + b"x" * 20), "image/webp")
        self.assertEqual(main._detectar_tipo_imagem(b"1234ftypavif" + b"x" * 20), "image/avif")

    def test_rejects_content_disguised_as_image(self):
        self.assertIsNone(main._detectar_tipo_imagem(b"<script>alert(1)</script>"))
        self.assertIsNone(main._detectar_tipo_imagem(b"PK\x03\x04not-an-image"))

    def test_sanitizes_original_filename(self):
        self.assertEqual(main._nome_original_seguro("C:\\camera\\foto.jpg"), "foto.jpg")
        self.assertEqual(main._nome_original_seguro("../../foto\x00.png"), "foto.png")


if __name__ == "__main__":
    unittest.main()
