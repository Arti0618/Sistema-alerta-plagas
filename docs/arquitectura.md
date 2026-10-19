Arquitectura del sistema
Propósito

El sistema busca reducir el tiempo entre la recepción de un reporte agrícola y su atención, mediante la interpretación automática del mensaje, la aplicación de reglas y la aprobación de un coordinador.

Usuarios del sistema
Productor

El productor enviará reportes mediante Telegram. Los reportes podrán contener texto, fotografías o notas de voz.

Coordinador

El coordinador utilizará una aplicación web para revisar los casos interpretados, comprobar la prioridad, aprobar la asignación o seleccionar a otro técnico.

Técnico

El técnico recibirá una notificación después de que el coordinador apruebe la asignación del caso.

Componentes principales
1. Telegram

Será el medio inicial para recibir los reportes de los productores y enviar las notificaciones correspondientes.

2. Agente de recepción e interpretación

El agente recibirá el contenido enviado mediante Telegram y lo preparará para su procesamiento.

La inteligencia artificial deberá extraer:

Si el mensaje corresponde a un reporte agrícola.
Cultivo afectado.
Síntomas descritos.
Posible plaga.
Superficie afectada.
Nivel de confianza.
Datos faltantes.

La inteligencia artificial solamente interpretará el reporte. No determinará directamente la prioridad ni seleccionará de manera definitiva al técnico.

3. Motor de reglas

El motor de reglas utilizará la información interpretada para determinar:

Posibles reportes duplicados.
Prioridad de 0 a 100.
Color del semáforo.
Posible presencia de un brote.
Técnico recomendado.
Tiempo máximo de atención.

Las reglas deberán ser claras, verificables y modificables.

4. Base de datos

Supabase almacenará inicialmente:

Reportes recibidos.
Resultados de la interpretación.
Casos generados.
Técnicos disponibles.
Asignaciones.
Aprobaciones.
Acciones y notificaciones.

Las credenciales de conexión no deberán almacenarse directamente en el repositorio.

5. Aplicación web

El coordinador utilizará una aplicación web desde un navegador.

La aplicación permitirá:

Consultar los reportes pendientes.
Revisar la interpretación de la inteligencia artificial.
Consultar la prioridad calculada.
Visualizar las fotografías recibidas.
Revisar el técnico recomendado.
Aprobar una asignación.
Cambiar al técnico propuesto.
Solicitar información adicional.
Consultar el historial del caso.

La primera versión será una aplicación web y no una APK.

6. Servicio de notificaciones

Después de la aprobación del coordinador, el sistema enviará avisos al productor y al técnico mediante Telegram.

No se enviará la asignación definitiva antes de la aprobación.

Flujo principal
El productor envía un reporte mediante Telegram.
El agente recibe el texto, la fotografía o la nota de voz.
Si existe una nota de voz, el sistema la convierte en texto.
La inteligencia artificial interpreta el contenido.
La interpretación se almacena en Supabase.
El motor de reglas calcula la prioridad y recomienda un técnico.
El coordinador revisa el caso desde la aplicación web.
El coordinador aprueba la asignación o selecciona otro técnico.
El sistema registra la decisión.
Telegram envía las notificaciones al productor y al técnico.
Las acciones quedan almacenadas para seguimiento.
Separación de responsabilidades

El sistema debe mantener separadas las siguientes responsabilidades:

La inteligencia artificial interpreta los datos.
El motor de reglas calcula la prioridad y propone la asignación.
El coordinador toma la decisión final.
El servicio de notificaciones comunica la decisión aprobada.

Esta separación permitirá explicar cómo se obtuvo cada resultado y evitará que la inteligencia artificial tome decisiones definitivas sin supervisión.

Estructura del repositorio
app/: aplicación web utilizada por el coordinador.
agente/: recepción de mensajes, integración con Telegram e inteligencia artificial.
reglas/: prioridad, duplicados, brotes y asignación de técnicos.
datos/: catálogos, ejemplos y datos ficticios.
docs/: arquitectura, tareas y documentación.
pruebas/: casos normales, incompletos y ambiguos.
scripts/: herramientas auxiliares para pruebas y despliegue.
Seguridad

El repositorio no deberá contener:

Contraseñas.
Tokens de Telegram.
Claves privadas.
Claves secretas de Supabase.
Credenciales de servicios de inteligencia artificial.
Contraseñas del servidor.
Archivos .env con datos reales.

Las credenciales se administrarán mediante variables de entorno. Se podrá incluir un archivo .env.example que indique los nombres de las variables necesarias, pero nunca sus valores reales.

Tecnologías previstas

Las tecnologías iniciales consideradas son:

Telegram para recibir reportes y enviar notificaciones.
Supabase para almacenar la información.
Python para el agente, la automatización y el motor de reglas.
HTML, CSS y JavaScript para la aplicación web.
Git y GitHub para el control de versiones.
Un servidor o servicio de despliegue para mantener el agente y la aplicación disponibles.