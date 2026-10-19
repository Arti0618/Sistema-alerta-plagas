Tareas del proyecto
Fase 1. Preparación del repositorio
 Crear la carpeta principal del proyecto.
 Inicializar el repositorio local de Git.
 Establecer main como rama principal.
 Crear la estructura inicial de carpetas.
 Crear README.md.
 Crear .gitignore.
 Crear docs/arquitectura.md.
 Crear docs/tareas.md.
 Crear el primer commit.
 Crear el repositorio en GitHub.
 Conectar el repositorio local con GitHub.
 Subir la rama main a GitHub.
Fase 2. Base de datos
 Crear un proyecto nuevo en Supabase.
 Diseñar la tabla de reportes recibidos.
 Diseñar la tabla de casos interpretados.
 Diseñar la tabla de técnicos.
 Diseñar la tabla de asignaciones.
 Diseñar la tabla de aprobaciones.
 Diseñar la tabla de acciones y notificaciones.
 Definir las relaciones entre las tablas.
 Configurar Row Level Security.
 Preparar un archivo .env.example.
 Probar la conexión con Supabase sin exponer credenciales.
Fase 3. Integración con la API del hackathon
 Revisar la documentación oficial de la API.
 Configurar las credenciales entregadas por los organizadores.
 Consultar los reportes nuevos.
 Consultar la información de productores y parcelas.
 Consultar los catálogos disponibles.
 Registrar los casos procesados.
 Manejar errores de conexión y respuestas incompletas.
 Evitar inventar rutas, campos o formatos de respuesta.
Fase 4. Agente e inteligencia artificial
 Crear el bot de Telegram.
 Recibir reportes en formato de texto.
 Recibir fotografías.
 Recibir notas de voz.
 Convertir las notas de voz en texto.
 Determinar si el mensaje corresponde a un reporte agrícola.
 Extraer el cultivo afectado.
 Extraer los síntomas.
 Identificar una posible plaga.
 Extraer la superficie afectada.
 Calcular un nivel de confianza.
 Identificar los datos faltantes.
 Guardar la interpretación en Supabase.
 Evitar que la inteligencia artificial asigne directamente la prioridad o el técnico.
Fase 5. Motor de reglas
 Definir los criterios de prioridad.
 Calcular la prioridad de 0 a 100.
 Definir los colores del semáforo.
 Detectar posibles reportes duplicados.
 Detectar posibles brotes.
 Definir los criterios de asignación de técnicos.
 Recomendar un técnico.
 Calcular el tiempo máximo de atención.
 Documentar las reglas utilizadas.
 Crear pruebas para cada regla.
Fase 6. Aplicación web del coordinador
 Diseñar la pantalla de acceso.
 Diseñar la lista de reportes pendientes.
 Mostrar la interpretación de la inteligencia artificial.
 Mostrar las fotografías recibidas.
 Mostrar la prioridad y el color del semáforo.
 Mostrar los datos faltantes.
 Mostrar el técnico recomendado.
 Agregar la opción para aprobar la asignación.
 Agregar la opción para cambiar al técnico.
 Agregar la opción para solicitar información adicional.
 Mostrar el historial de cada caso.
 Adaptar el panel para computadora y teléfono.
Fase 7. Aprobación y notificaciones
 Enviar el resumen del caso al coordinador.
 Registrar la decisión del coordinador.
 Evitar notificaciones definitivas antes de la aprobación.
 Notificar al técnico después de la aprobación.
 Notificar al productor después de la aprobación.
 Registrar las notificaciones enviadas.
 Manejar errores durante el envío.
Fase 8. Pruebas
 Crear reportes de prueba normales.
 Crear reportes con información incompleta.
 Crear reportes con nombres locales de plagas.
 Crear reportes que no sean agrícolas.
 Crear casos duplicados.
 Crear casos que simulen un brote.
 Comprobar el cálculo de prioridad.
 Comprobar la asignación de técnicos.
 Comprobar la aprobación del coordinador.
 Verificar que no se expongan credenciales.
Fase 9. Despliegue y presentación
 Desplegar la aplicación web.
 Desplegar el agente.
 Configurar las variables de entorno en el servidor.
 Mantener los servicios disponibles.
 Ejecutar una demostración completa.
 Preparar la explicación de la arquitectura.
 Preparar la defensa individual.
 Revisar el repositorio antes de la presentación.
 Comprobar que no existan secretos en GitHub.
Notas
La inteligencia artificial interpreta los reportes.
El motor de reglas calcula la prioridad y recomienda un técnico.
El coordinador toma la decisión final.
Las notificaciones definitivas se envían después de la aprobación.
Las credenciales reales nunca deben guardarse en GitHub.