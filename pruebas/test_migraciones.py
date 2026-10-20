"""Pruebas estáticas de la migración de idempotencia de Telegram."""

import re
import unittest
from pathlib import Path


RUTA_MIGRACION = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20261019000300_reportes_telegram_idempotencia_por_chat.sql"
)


class PruebasIdempotenciaTelegram(unittest.TestCase):
    """Comprueba la clave única sin aplicar la migración en Supabase."""

    @classmethod
    def setUpClass(cls):
        cls.sql = RUTA_MIGRACION.read_text(encoding="utf-8").lower()

    def test_elimina_la_restriccion_anterior(self):
        self.assertIn(
            "drop constraint if exists "
            "reportes_canal_telegram_message_id_unico",
            self.sql,
        )

    def test_crea_un_indice_unico_por_chat_y_mensaje(self):
        patron = re.compile(
            r"create unique index if not exists\s+"
            r"reportes_canal_chat_mensaje_unico\s+"
            r"on public\.reportes\s*\(\s*"
            r"canal\s*,\s*"
            r"\(metadatos\s*->>\s*'telegram_chat_id'\)\s*,\s*"
            r"telegram_message_id\s*\)",
            re.DOTALL,
        )

        self.assertRegex(self.sql, patron)

    def test_no_agrega_ni_elimina_columnas(self):
        self.assertNotIn("add column", self.sql)
        self.assertNotIn("drop column", self.sql)


if __name__ == "__main__":
    unittest.main()
