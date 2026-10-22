"""Pruebas de las reglas puras para Nivel 2."""

import unittest

from reglas.asignador_tecnicos import asignar_tecnico
from reglas.prioridad import calcular_prioridad
from reglas.semaforo import calcular_semaforo, valores_validos


PLAGA_MAIZ = {
    "severidad": "alta",
    "cuarentenaria": False,
    "etapas_criticas": {"maíz": ["V6", "V8"]},
    "etapas_susceptibles": {"maíz": ["V10", "V12"]},
}


class CalcularPrioridadTests(unittest.TestCase):
    """Comprueba severidad, superficie, etapa y cuarentena."""

    def test_severidad_sin_superficie_ni_etapa(self):
        self.assertEqual(
            calcular_prioridad({"severidad": "baja", "cuarentenaria": False}),
            15,
        )
        self.assertEqual(
            calcular_prioridad({"severidad": "media", "cuarentenaria": False}),
            25,
        )
        self.assertEqual(
            calcular_prioridad({"severidad": "alta", "cuarentenaria": False}),
            40,
        )
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "critica", "cuarentenaria": False}
            ),
            50,
        )
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "Crítica", "cuarentenaria": False}
            ),
            50,
        )

    def test_cuarentenaria_fuerza_cien(self):
        for severidad in ("baja", "media", "alta", "critica"):
            with self.subTest(severidad=severidad):
                self.assertEqual(
                    calcular_prioridad(
                        {
                            "severidad": severidad,
                            "cuarentenaria": True,
                        }
                    ),
                    100,
                )

    def test_acepta_campo_cuarentena_o_cuarentenaria(self):
        self.assertEqual(
            calcular_prioridad({"severidad": "alta", "cuarentena": True}),
            100,
        )
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": "sí"}
            ),
            100,
        )
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": "no"}
            ),
            40,
        )

    def test_severidad_desconocida_es_cero(self):
        self.assertEqual(
            calcular_prioridad({"severidad": "invalida"}),
            0,
        )

    def test_entrada_invalida_es_cero(self):
        self.assertEqual(calcular_prioridad(None), 0)
        self.assertEqual(calcular_prioridad({}), 0)
        self.assertEqual(calcular_prioridad("no-dict"), 0)

    def test_superficie_redondeo_comercial(self):
        # 4 ha * 25% = 1 ha; 1 * 6.25 = 6.25 -> 6
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=25,
            ),
            46,
        )
        # 4 ha * 50% = 2 ha; 2 * 6.25 = 12.5 -> 13 (mitad hacia arriba)
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=50,
            ),
            53,
        )
        # 4 ha * 100% = 4 ha; 4 * 6.25 = 25
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=100,
            ),
            65,
        )

    def test_superficie_se_capa_en_veinticinco(self):
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "baja", "cuarentenaria": False},
                superficie_ha=100,
                pct=100,
            ),
            40,
        )

    def test_pct_nulo_usa_diez_por_ciento(self):
        # 4 ha * 10% = 0.4 ha; 0.4 * 6.25 = 2.5 -> 3
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=None,
            ),
            43,
        )

    def test_pct_se_limita_entre_cero_y_cien(self):
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=-10,
            ),
            40,
        )
        self.assertEqual(
            calcular_prioridad(
                {"severidad": "alta", "cuarentenaria": False},
                superficie_ha=4,
                pct=150,
            ),
            65,
        )

    def test_etapa_critica_susceptible_otra_y_desconocida(self):
        self.assertEqual(
            calcular_prioridad(
                PLAGA_MAIZ,
                etapa="V6",
                cultivo="maíz",
            ),
            65,
        )
        self.assertEqual(
            calcular_prioridad(
                PLAGA_MAIZ,
                etapa="V10",
                cultivo="maíz",
            ),
            55,
        )
        self.assertEqual(
            calcular_prioridad(
                PLAGA_MAIZ,
                etapa="R2",
                cultivo="maíz",
            ),
            45,
        )
        self.assertEqual(
            calcular_prioridad(PLAGA_MAIZ, etapa=None, cultivo="maíz"),
            40,
        )

    def test_etapa_exige_cultivo_coincidente(self):
        self.assertEqual(
            calcular_prioridad(
                PLAGA_MAIZ,
                etapa="V6",
                cultivo="frijol",
            ),
            45,
        )

    def test_etapa_y_cultivo_ignoran_tildes_y_mayusculas(self):
        self.assertEqual(
            calcular_prioridad(
                PLAGA_MAIZ,
                etapa=" v6 ",
                cultivo="MAÍZ",
            ),
            65,
        )

    def test_total_se_capa_en_cien(self):
        plaga = {
            "severidad": "critica",
            "cuarentenaria": False,
            "etapas_criticas": {"maíz": ["V6"]},
            "etapas_susceptibles": {},
        }
        self.assertEqual(
            calcular_prioridad(
                plaga,
                superficie_ha=100,
                pct=100,
                etapa="V6",
                cultivo="maíz",
            ),
            100,
        )


class CalcularSemaforoTests(unittest.TestCase):
    """Comprueba el mapeo de prioridad a color."""

    def test_colores_validos(self):
        self.assertEqual(
            set(valores_validos()),
            {"rojo", "naranja", "amarillo", "verde"},
        )

    def test_rojo_desde_ochenta_y_cinco(self):
        self.assertEqual(calcular_semaforo(85), "rojo")
        self.assertEqual(calcular_semaforo(100), "rojo")

    def test_naranja_desde_setenta(self):
        self.assertEqual(calcular_semaforo(70), "naranja")
        self.assertEqual(calcular_semaforo(84), "naranja")

    def test_amarillo_desde_cuarenta(self):
        self.assertEqual(calcular_semaforo(40), "amarillo")
        self.assertEqual(calcular_semaforo(69), "amarillo")

    def test_verde_bajo_cuarenta(self):
        self.assertEqual(calcular_semaforo(0), "verde")
        self.assertEqual(calcular_semaforo(39), "verde")

    def test_entrada_invalida_es_none(self):
        self.assertIsNone(calcular_semaforo(None))
        self.assertIsNone(calcular_semaforo("alto"))
        self.assertIsNone(calcular_semaforo(True))


class AsignarTecnicoTests(unittest.TestCase):
    """Comprueba carga, especialidad, Haversine y desempates."""

    PLAGA_ENTOMOLOGIA = {"especialidad": "entomologia"}
    PLAGA_MAIZ = {"cultivos": ["maíz"]}

    def _tec(self, **kwargs):
        base = {
            "id": "t-base",
            "nombre": "Base",
            "especialidades": [],
            "casos_activos": 0,
            "capacidad_maxima_casos": 5,
            "disponible": True,
            "lat": None,
            "lon": None,
        }
        base.update(kwargs)
        return base

    def test_prefiere_especialidad_aunque_este_mas_lejos(self):
        candidatos = [
            self._tec(
                id="t-cerca",
                especialidades=["fitopatologia"],
                lat=19.001,
                lon=-99.0,
            ),
            self._tec(
                id="t-lejos",
                especialidades=["entomologia"],
                lat=20.0,
                lon=-99.0,
            ),
        ]
        self.assertEqual(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                self.PLAGA_ENTOMOLOGIA,
            ),
            "t-lejos",
        )

    def test_entre_especialistas_elige_el_mas_cercano(self):
        candidatos = [
            self._tec(
                id="t-lejos",
                especialidades=["entomologia"],
                lat=19.5,
                lon=-99.0,
            ),
            self._tec(
                id="t-cerca",
                especialidades=["entomologia"],
                lat=19.01,
                lon=-99.0,
            ),
        ]
        self.assertEqual(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                self.PLAGA_ENTOMOLOGIA,
            ),
            "t-cerca",
        )

    def test_excluye_carga_mayor_o_igual_a_cinco(self):
        candidatos = [
            self._tec(
                id="t-lleno",
                especialidades=["entomologia"],
                casos_activos=5,
            ),
        ]
        self.assertIsNone(
            asignar_tecnico({}, candidatos, self.PLAGA_ENTOMOLOGIA)
        )

    def test_desempata_por_carga_y_luego_por_id(self):
        candidatos = [
            self._tec(
                id="t-b",
                especialidades=["entomologia"],
                casos_activos=1,
                lat=19.0,
                lon=-99.0,
            ),
            self._tec(
                id="t-a",
                especialidades=["entomologia"],
                casos_activos=1,
                lat=19.0,
                lon=-99.0,
            ),
            self._tec(
                id="t-c",
                especialidades=["entomologia"],
                casos_activos=0,
                lat=19.0,
                lon=-99.0,
            ),
        ]
        self.assertEqual(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                self.PLAGA_ENTOMOLOGIA,
            ),
            "t-c",
        )
        candidatos = candidatos[:2]
        self.assertEqual(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                self.PLAGA_ENTOMOLOGIA,
            ),
            "t-a",
        )

    def test_sin_especialista_devuelve_none(self):
        candidatos = [
            self._tec(
                id="t-lejos",
                especialidades=["fitopatologia"],
                lat=20.0,
                lon=-99.0,
            ),
            self._tec(
                id="t-cerca",
                especialidades=["fitopatologia"],
                lat=19.01,
                lon=-99.0,
            ),
        ]
        self.assertIsNone(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                self.PLAGA_ENTOMOLOGIA,
            )
        )

    def test_sin_coordenadas_desempata_por_carga_e_id(self):
        candidatos = [
            self._tec(
                id="t-b",
                especialidades=["entomologia"],
                casos_activos=0,
            ),
            self._tec(
                id="t-a",
                especialidades=["entomologia"],
                casos_activos=0,
            ),
        ]
        self.assertEqual(
            asignar_tecnico({}, candidatos, self.PLAGA_ENTOMOLOGIA),
            "t-a",
        )

    def test_excluye_no_disponibles(self):
        candidatos = [
            self._tec(
                id="t-a",
                disponible=False,
                especialidades=["entomologia"],
            ),
        ]
        self.assertIsNone(
            asignar_tecnico({}, candidatos, self.PLAGA_ENTOMOLOGIA)
        )

    def test_sin_candidatos_es_none(self):
        self.assertIsNone(asignar_tecnico({}, [], self.PLAGA_MAIZ))
        self.assertIsNone(asignar_tecnico({}, None, self.PLAGA_MAIZ))

    def test_cultivo_no_sustituye_especialidad(self):
        candidatos = [
            self._tec(id="t-a", especialidades=["Maíz"], casos_activos=0),
        ]
        self.assertIsNone(
            asignar_tecnico({}, candidatos, self.PLAGA_MAIZ)
        )

    def test_plaga_sin_especialidad_devuelve_none(self):
        candidatos = [
            self._tec(
                id="t-lejos",
                especialidades=["papa"],
                casos_activos=0,
                lat=20.0,
                lon=-99.0,
            ),
            self._tec(
                id="t-cerca",
                especialidades=["papa"],
                casos_activos=0,
                lat=19.01,
                lon=-99.0,
            ),
        ]
        self.assertIsNone(
            asignar_tecnico(
                {"lat": 19.0, "lon": -99.0},
                candidatos,
                {"cultivos": []},
            )
        )


if __name__ == "__main__":
    unittest.main()
