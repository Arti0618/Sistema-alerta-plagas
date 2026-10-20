"""Pruebas de la regla de urgencia.

Todas las pruebas son locales: no se llama a la API del reto, a Supabase
ni a OpenRouter.
"""

import unittest

from agente.cliente_api_reto import normalizar_catalogo_plagas
from reglas.urgencia import calcular_urgencia


def registro(
    id_plaga="plaga-1",
    severidad=None,
    cuarentenaria=False,
):
    """Construye un registro con la forma del catálogo normalizado."""

    return {
        "id": id_plaga,
        "nombre": "Plaga de prueba",
        "nombres_locales": [],
        "cultivos": [],
        "sintomas": [],
        "severidad": severidad,
        "cuarentenaria": cuarentenaria,
    }


class PruebasCalcularUrgencia(unittest.TestCase):
    """Comprueba los criterios de la regla de urgencia."""

    def test_una_plaga_cuarentenaria_es_urgente(self):
        self.assertTrue(calcular_urgencia(plaga=registro(cuarentenaria=True)))

    def test_una_severidad_alta_es_urgente(self):
        self.assertTrue(calcular_urgencia(plaga=registro(severidad="alta")))

    def test_una_severidad_baja_no_es_urgente(self):
        self.assertFalse(calcular_urgencia(plaga=registro(severidad="baja")))

    def test_una_plaga_sin_datos_de_urgencia_no_es_urgente(self):
        self.assertFalse(calcular_urgencia(plaga=registro()))

    def test_la_cuarentena_prevalece_sobre_la_severidad_baja(self):
        marcada = registro(severidad="baja", cuarentenaria=True)

        self.assertTrue(calcular_urgencia(plaga=marcada))

    def test_devuelve_siempre_un_booleano(self):
        casos = (
            registro(),
            registro(severidad="alta"),
            registro(cuarentenaria=True),
        )

        for caso in casos:
            with self.subTest(plaga=caso):
                self.assertIs(type(calcular_urgencia(plaga=caso)), bool)

    def test_acepta_severidad_con_mayusculas_y_espacios(self):
        self.assertTrue(
            calcular_urgencia(plaga=registro(severidad="  ALTA  "))
        )

    def test_el_registro_de_plaga_desconocida_no_es_urgente(self):
        desconocida = registro(id_plaga="desconocida", severidad=None)

        self.assertFalse(calcular_urgencia(plaga=desconocida))

    def test_una_plaga_que_no_es_diccionario_no_es_urgente(self):
        for valor in (None, [], "alta", 7):
            with self.subTest(plaga=valor):
                self.assertFalse(calcular_urgencia(plaga=valor))

    def test_una_severidad_numerica_no_se_considera_alta(self):
        # La escala numérica de la API todavía no está confirmada, así
        # que se degrada a no urgente en lugar de suponer un umbral.
        for severidad in (1, 2, 3, 5, 100):
            with self.subTest(severidad=severidad):
                self.assertFalse(
                    calcular_urgencia(plaga=registro(severidad=severidad))
                )

    def test_exige_la_cuarentenaria_ya_normalizada(self):
        # El catálogo entrega un booleano, nunca texto.
        self.assertFalse(
            calcular_urgencia(plaga=registro(cuarentenaria="si"))
        )


class PruebasConElCatalogoNormalizado(unittest.TestCase):
    """La regla debe funcionar con el catálogo real ya normalizado."""

    def _primera_plaga(self, **campos):
        catalogo = normalizar_catalogo_plagas(
            [{"id": "plaga-1", "nombre": "Gusano", **campos}]
        )

        return catalogo[0]

    def test_recibe_el_registro_completo_del_catalogo(self):
        plaga = self._primera_plaga()

        self.assertEqual(
            set(plaga),
            {
                "id",
                "nombre",
                "nombres_locales",
                "cultivos",
                "sintomas",
                "severidad",
                "cuarentenaria",
            },
        )

    def test_usa_la_severidad_del_catalogo(self):
        plaga = self._primera_plaga(severidad="alta")

        self.assertTrue(calcular_urgencia(plaga=plaga))

    def test_convierte_la_cuarentenaria_en_texto(self):
        plaga = self._primera_plaga(cuarentenaria="sí")

        self.assertIs(plaga["cuarentenaria"], True)
        self.assertTrue(calcular_urgencia(plaga=plaga))

    def test_un_catalogo_sin_datos_de_urgencia_no_es_urgente(self):
        plaga = self._primera_plaga()

        self.assertIsNone(plaga["severidad"])
        self.assertIs(plaga["cuarentenaria"], False)
        self.assertFalse(calcular_urgencia(plaga=plaga))


if __name__ == "__main__":
    unittest.main()
