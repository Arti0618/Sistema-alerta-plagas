"""Almacén local para evitar crear dos veces un caso del mismo reporte.

Solo guarda identificadores de reportes ya creados, nunca textos,
nombres, ubicaciones ni otros datos personales. El archivo se escribe de
forma atómica para no dejarlo incompleto si el proceso se interrumpe.
"""

import json
import os
import threading
from pathlib import Path


RUTA_ESTADO_POR_DEFECTO = (
    Path(__file__).resolve().parent.parent
    / "datos"
    / "reportes_procesados.json"
)


class ErrorAlmacenReportes(Exception):
    """Error al leer o guardar el estado local."""

    def __init__(self, mensaje):
        self.message = mensaje
        super().__init__(mensaje)


class AlmacenReportes:
    """Conjunto persistente de IDs de reportes ya procesados."""

    def __init__(self, ruta=RUTA_ESTADO_POR_DEFECTO):
        self.ruta = Path(ruta)
        self._candado = threading.Lock()
        self._ids = self._cargar()

    def _cargar(self):
        if not self.ruta.exists():
            return set()

        try:
            with self.ruta.open("r", encoding="utf-8") as archivo:
                datos = json.load(archivo)
        except (OSError, json.JSONDecodeError) as error:
            raise ErrorAlmacenReportes(
                "No fue posible leer el estado de reportes procesados."
            ) from error

        if not isinstance(datos, list):
            raise ErrorAlmacenReportes(
                "El estado de reportes procesados no es válido."
            )

        ids = set()
        for valor in datos:
            if not isinstance(valor, str) or not valor.strip():
                raise ErrorAlmacenReportes(
                    "El estado de reportes procesados no es válido."
                )
            ids.add(valor.strip())

        return ids

    def contiene(self, reporte_id):
        return str(reporte_id).strip() in self._ids

    def registrar(self, reporte_id):
        """Registra un ID. Devuelve False si ya estaba registrado."""

        clave = str(reporte_id).strip()
        if not clave:
            raise ValueError("El ID del reporte no puede estar vacío.")

        with self._candado:
            if clave in self._ids:
                return False

            self._ids.add(clave)
            try:
                self._guardar()
            except Exception:
                self._ids.discard(clave)
                raise
            return True

    def _guardar(self):
        temporal = self.ruta.with_name(self.ruta.name + ".tmp")

        try:
            self.ruta.parent.mkdir(parents=True, exist_ok=True)
            with temporal.open("w", encoding="utf-8") as archivo:
                json.dump(
                    sorted(self._ids),
                    archivo,
                    ensure_ascii=False,
                    indent=2,
                )
                archivo.write("\n")
            os.replace(temporal, self.ruta)
        except OSError as error:
            try:
                temporal.unlink()
            except OSError:
                pass
            raise ErrorAlmacenReportes(
                "No fue posible guardar el estado de reportes procesados."
            ) from error
