"""Pruebas de orquestación, modo seguro y prevención de duplicados."""

import tempfile
import unittest
from pathlib import Path

from agente.almacen_reporte_ids import AlmacenReportes
from agente.cliente_api_reto import ErrorApiReto
from agente.procesador_reto import (
    ErrorUrgencia,
    ProcesadorReportes,
    construir_caso,
)
from pruebas.ayudas_simuladas import (
    ClasificadorFalso,
    ClienteApiFalso,
    configuracion_reto,
)


CATALOGO = [{"id": "plaga-1", "nombre": "Gusano"}]
REPORTE = {
    "id": "r-1",
    "texto": "Hojas perforadas en el cultivo.",
}


class ProcesadorReportesTests(unittest.TestCase):
    def _crear_procesador(
        self,
        *,
        enviar=False,
        reportes=None,
        catalogo=None,
        clasificador=None,
        error_validar=None,
        error_crear=None,
        urgencia=None,
    ):
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        almacen = AlmacenReportes(
            Path(temporal.name) / "estado.json"
        )
        cliente = ClienteApiFalso(
            reportes=(
                [dict(REPORTE)] if reportes is None else reportes
            ),
            catalogo=CATALOGO if catalogo is None else catalogo,
            error_validar=error_validar,
            error_crear=error_crear,
        )
        clasificador = clasificador or ClasificadorFalso()
        urgencias = []

        if urgencia is None:
            def urgencia(**argumentos):
                urgencias.append(argumentos)
                return True

        procesador = ProcesadorReportes(
            cliente=cliente,
            clasificador=clasificador,
            configuracion=configuracion_reto(enviar),
            almacen=almacen,
            calcular_urgencia=urgencia,
        )
        return procesador, cliente, clasificador, almacen, urgencias

    def test_construir_caso_mapea_plaga_id_a_plaga(self):
        caso = construir_caso(
            {"id": "r-1"},
            {"es_plaga": True, "plaga_id": "plaga-1"},
            True,
        )

        self.assertEqual(
            caso,
            {
                "reporte_id": "r-1",
                "es_plaga": True,
                "plaga": "plaga-1",
                "urgente": True,
            },
        )
        self.assertEqual(
            set(caso),
            {"reporte_id", "es_plaga", "plaga", "urgente"},
        )
        self.assertIs(caso["es_plaga"], True)
        self.assertIs(caso["urgente"], True)
        self.assertNotIn("plaga_id", caso)
        self.assertNotIn("urgencia", caso)

    def test_construir_caso_sin_plaga_usa_desconocida(self):
        caso = construir_caso(
            {"id": "r-2"},
            {"es_plaga": False, "plaga_id": "plaga-1"},
            False,
        )

        self.assertEqual(
            caso,
            {
                "reporte_id": "r-2",
                "es_plaga": False,
                "plaga": "desconocida",
                "urgente": False,
            },
        )
        self.assertIs(caso["es_plaga"], False)
        self.assertIs(caso["urgente"], False)

    def test_construir_caso_rechaza_es_plaga_no_booleano(self):
        with self.assertRaises(ValueError):
            construir_caso(
                {"id": "r-1"},
                {"es_plaga": 1, "plaga_id": "plaga-1"},
                True,
            )

    def test_construir_caso_rechaza_urgente_no_booleano(self):
        with self.assertRaises(ErrorUrgencia):
            construir_caso(
                {"id": "r-1"},
                {"es_plaga": True, "plaga_id": "plaga-1"},
                "alta",
            )

    def test_modo_seguro_valida_pero_no_crea(self):
        procesador, cliente, _, almacen, urgencias = (
            self._crear_procesador()
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertTrue(resumen.modo_simulacion)
        self.assertEqual(resumen.reportes_leidos, 1)
        self.assertEqual(resumen.validados, 1)
        self.assertEqual(resumen.casos_simulados, 1)
        self.assertEqual(resumen.casos_creados, 0)
        self.assertEqual(resumen.errores, 0)
        self.assertIn(
            ("validar_caso", {
                "reporte_id": "r-1",
                "es_plaga": True,
                "plaga": "plaga-1",
                "urgente": True,
            }),
            cliente.llamadas,
        )
        self.assertFalse(
            any(llamada[0] == "crear_caso" for llamada in cliente.llamadas)
        )
        self.assertFalse(almacen.contiene("r-1"))
        self.assertEqual(len(urgencias), 1)
        self.assertEqual(
            urgencias[0]["reporte"],
            REPORTE,
        )

    def test_reporte_sin_plaga_no_valida_ni_crea(self):
        clasificador = ClasificadorFalso(
            resultado={
                "es_plaga": False,
                "plaga_id": "desconocida",
            }
        )
        procesador, cliente, _, _, _ = self._crear_procesador(
            clasificador=clasificador
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.sin_plaga, 1)
        self.assertEqual(resumen.validados, 0)
        self.assertFalse(
            any(
                llamada[0] in ("validar_caso", "crear_caso")
                for llamada in cliente.llamadas
            )
        )

    def test_duplicado_en_mismo_lote_se_omite(self):
        reportes = [dict(REPORTE), dict(REPORTE)]
        procesador, cliente, clasificador, _, _ = (
            self._crear_procesador(reportes=reportes)
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.reportes_leidos, 2)
        self.assertEqual(resumen.duplicados, 1)
        self.assertEqual(len(clasificador.llamadas), 1)
        self.assertEqual(
            sum(
                1
                for llamada in cliente.llamadas
                if llamada[0] == "validar_caso"
            ),
            1,
        )

    def test_duplicado_persistente_se_omite_antes_de_clasificar(self):
        procesador, cliente, clasificador, almacen, _ = (
            self._crear_procesador(
                reportes=[dict(REPORTE)],
            )
        )
        almacen.registrar("r-1")

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.duplicados, 1)
        self.assertEqual(clasificador.llamadas, [])
        self.assertFalse(
            any(llamada[0] == "validar_caso" for llamada in cliente.llamadas)
        )

    def test_modo_real_crea_y_registra_id(self):
        procesador, cliente, _, almacen, _ = self._crear_procesador(
            enviar=True
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertFalse(resumen.modo_simulacion)
        self.assertEqual(resumen.casos_creados, 1)
        self.assertEqual(resumen.casos_simulados, 0)
        self.assertTrue(almacen.contiene("r-1"))
        creaciones = [
            llamada
            for llamada in cliente.llamadas
            if llamada[0] == "crear_caso"
        ]
        self.assertEqual(len(creaciones), 1)
        self.assertEqual(
            creaciones[0][1],
            {
                "reporte_id": "r-1",
                "es_plaga": True,
                "plaga": "plaga-1",
                "urgente": True,
            },
        )

    def test_validacion_fallida_no_crea_ni_registra(self):
        procesador, cliente, _, almacen, _ = self._crear_procesador(
            enviar=True,
            error_validar=ErrorApiReto(
                "La API no validó el caso.",
                status_code=422,
            ),
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.validados, 0)
        self.assertEqual(resumen.errores, 1)
        self.assertFalse(almacen.contiene("r-1"))
        self.assertFalse(
            any(llamada[0] == "crear_caso" for llamada in cliente.llamadas)
        )

    def test_conflicto_409_se_trata_como_duplicado(self):
        procesador, _, _, almacen, _ = self._crear_procesador(
            enviar=True,
            error_crear=ErrorApiReto(
                "La API respondió con estado 409.",
                status_code=409,
            ),
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.duplicados, 1)
        self.assertEqual(resumen.errores, 0)
        self.assertTrue(almacen.contiene("r-1"))

    def test_error_al_crear_no_registra(self):
        procesador, _, _, almacen, _ = self._crear_procesador(
            enviar=True,
            error_crear=ErrorApiReto(
                "La API respondió con estado 500.",
                status_code=500,
            ),
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertEqual(resumen.casos_creados, 0)
        self.assertFalse(almacen.contiene("r-1"))

    def test_error_del_clasificador_se_contabiliza(self):
        clasificador = ClasificadorFalso(
            error=RuntimeError("fallo simulado")
        )
        procesador, cliente, _, _, _ = self._crear_procesador(
            clasificador=clasificador
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertFalse(
            any(llamada[0] == "validar_caso" for llamada in cliente.llamadas)
        )

    def test_error_de_urgencia_no_valida(self):
        def urgencia_que_falla(**argumentos):
            raise RuntimeError("fallo simulado")

        procesador, cliente, _, _, _ = self._crear_procesador(
            urgencia=urgencia_que_falla
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertFalse(
            any(llamada[0] == "validar_caso" for llamada in cliente.llamadas)
        )

    def test_urgencia_no_booleana_no_valida(self):
        procesador, cliente, _, _, _ = self._crear_procesador(
            urgencia=lambda **argumentos: "alta"
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertFalse(
            any(llamada[0] == "validar_caso" for llamada in cliente.llamadas)
        )

    def test_clasificacion_con_id_fuera_del_catalogo_no_valida(self):
        clasificador = ClasificadorFalso(
            resultado={
                "es_plaga": True,
                "plaga_id": "plaga-999",
            }
        )
        procesador, cliente, _, _, _ = self._crear_procesador(
            clasificador=clasificador
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertFalse(
            any(llamada[0] == "validar_caso" for llamada in cliente.llamadas)
        )

    def test_reporte_sin_id_se_contabiliza_sin_clasificar(self):
        procesador, _, clasificador, _, _ = self._crear_procesador(
            reportes=[{"texto": "Sin identificador"}]
        )

        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertEqual(resumen.errores, 1)
        self.assertEqual(clasificador.llamadas, [])

    def test_resumen_no_contiene_texto_del_reporte(self):
        procesador, _, _, _, _ = self._crear_procesador()
        resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertNotIn("Hojas perforadas", repr(resumen))


if __name__ == "__main__":
    unittest.main()
