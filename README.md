Sistema de alerta de plagas

Proyecto desarrollado para el Hackathon Git, servidores y agentes de IA.

Problema

Los reportes agrícolas sobre posibles plagas pueden llegar incompletos, utilizar nombres locales o contener información ambigua. Si estos reportes no se interpretan y atienden oportunamente, la plaga puede extenderse antes de que un técnico intervenga.

Pregunta principal

¿Cómo lograr que el aviso de un productor se reciba, se interprete y se atienda antes de que la plaga se extienda?

Objetivo

Desarrollar un sistema que reciba reportes agrícolas, interprete su contenido, determine su prioridad mediante reglas, asigne un técnico y solicite la aprobación de un coordinador antes de enviar las notificaciones.

Funcionamiento general

El sistema separa tres responsabilidades:

La inteligencia artificial interpreta el reporte.
Las reglas determinan la prioridad y la asignación.
El coordinador aprueba antes de enviar las notificaciones.

Los reportes podrán recibirse mediante Telegram como texto, nota de voz o fotografía.

Estructura del proyecto
app/: aplicación o panel utilizado por el coordinador.
agente/: integración con Telegram e interpretación mediante inteligencia artificial.
reglas/: reglas de prioridad, duplicados, brotes y asignación de técnicos.
datos/: catálogos, ejemplos y datos ficticios sin información sensible.
docs/: arquitectura, tareas y documentación del proyecto.
pruebas/: casos utilizados para comprobar el funcionamiento del sistema.
scripts/: herramientas auxiliares para iniciar, probar o desplegar el proyecto.
Flujo previsto
El productor envía un reporte.
El sistema recibe el texto, la nota de voz o la fotografía.
La inteligencia artificial interpreta la información.
El motor de reglas calcula la prioridad y propone un técnico.
El coordinador revisa y aprueba la asignación.
El sistema notifica al productor y al técnico.
Las acciones quedan registradas para seguimiento.
Seguridad

Las credenciales, contraseñas, tokens y variables de entorno no deben almacenarse en el repositorio. Estos datos se manejarán mediante archivos locales de configuración y variables de entorno.

Cuando termines de pegarlo, guárdalo con Ctrl + S. Los símbolos #, ##, los números y los guiones son normales: permiten que GitHub muestre el archivo organizado con títulos, listas y secciones.
