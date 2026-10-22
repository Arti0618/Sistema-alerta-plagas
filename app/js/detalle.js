(function () {
  "use strict";

  const estado = document.getElementById("estado-carga");
  const detalle = document.getElementById("detalle");
  const salir = document.getElementById("boton-salir");
  const botonAprobar = document.getElementById("boton-aprobar");
  const botonCambiar = document.getElementById("boton-cambiar");
  const seccionTecnicos = document.getElementById("seccion-tecnicos");
  const selectorTecnico = document.getElementById("selector-tecnico");
  const confirmarCambio = document.getElementById("boton-confirmar-cambio");
  const cancelarCambio = document.getElementById("boton-cancelar-cambio");
  const comentario = document.getElementById("comentario");
  const resultado = document.getElementById("resultado");

  let casoId = null;
  let casoActual = null;
  let tecnicos = [];

  function token() {
    return sessionStorage.getItem("coordinador_token");
  }

  function obtenerIdCaso() {
    const params = new URLSearchParams(window.location.search);
    return params.get("caso");
  }

  function mostrarError(mensaje) {
    estado.textContent = mensaje;
    estado.hidden = false;
    detalle.hidden = true;
  }

  function ocultarError() {
    estado.hidden = true;
    detalle.hidden = false;
  }

  function pintarResultado(mensaje, esError) {
    resultado.textContent = mensaje;
    resultado.className = esError ? "resultado error" : "resultado";
    resultado.hidden = false;
  }

  function set(selector, valor) {
    const elemento = document.getElementById(selector);
    if (elemento) {
      elemento.textContent = valor == null || valor === "" ? "—" : valor;
    }
  }

  function claseSemaforo(color) {
    if (color === "verde" || color === "amarillo" || color === "rojo") {
      return color;
    }
    return "";
  }

  function pintarSemaforo(valor) {
    const elemento = document.getElementById("caso-semaforo");
    if (!elemento) {
      return;
    }
    if (!valor) {
      elemento.textContent = "—";
      elemento.className = "";
      return;
    }
    elemento.innerHTML =
      `<span class="semaforo ${claseSemaforo(valor)}">${valor}</span>`;
  }

  function pintarPrioridad(valor) {
    const elemento = document.getElementById("caso-prioridad");
    if (!elemento) {
      return;
    }
    if (valor == null) {
      elemento.textContent = "—";
      elemento.className = "";
      return;
    }
    let clase = "";
    if (valor >= 70) {
      clase = "alta";
    } else if (valor >= 40) {
      clase = "media";
    } else {
      clase = "baja";
    }
    elemento.innerHTML =
      `<span class="prioridad ${clase}">${valor}</span>`;
  }

  function pintarReporte(reporte) {
    if (!reporte) {
      set("reporte-tipo", "—");
      set("reporte-texto", "");
      return;
    }
    set("reporte-tipo", reporte.tipo_contenido || "—");
    set(
      "reporte-texto",
      reporte.mensaje_original || "(sin texto)",
    );

    const archivo = document.getElementById("reporte-archivo");
    if (reporte.archivo_url) {
      archivo.innerHTML =
        `<a href="${reporte.archivo_url}" target="_blank" rel="noopener">Ver archivo adjunto</a>`;
    } else {
      archivo.textContent = "";
    }
  }

  function pintarInterpretacion(inter) {
    if (!inter) {
      set("ia-es-agricola", "—");
      set("ia-cultivo", "—");
      set("ia-plaga", "—");
      set("ia-nombre-local", "—");
      set("ia-confianza", "—");
      set("ia-sintomas", "—");
      set("ia-datos-faltantes", "—");
      set("ia-resumen", "");
      return;
    }
    set(
      "ia-es-agricola",
      inter.es_reporte_agricola == null
        ? "—"
        : (inter.es_reporte_agricola ? "Sí" : "No"),
    );
    set("ia-cultivo", inter.cultivo || "—");
    set("ia-plaga", inter.posible_plaga || "—");
    set("ia-nombre-local", inter.nombre_local_plaga || "—");
    set(
      "ia-confianza",
      inter.nivel_confianza == null
        ? "—"
        : Math.round(inter.nivel_confianza * 100) + "%",
    );

    const sintomas = Array.isArray(inter.sintomas) && inter.sintomas.length
      ? inter.sintomas.join(", ")
      : "—";
    set("ia-sintomas", sintomas);

    const faltantes = Array.isArray(inter.datos_faltantes) && inter.datos_faltantes.length
      ? inter.datos_faltantes.join(", ")
      : "—";
    set("ia-datos-faltantes", faltantes);
    set("ia-resumen", inter.resumen || "");
  }

  function pintarAsignacion(asignacion) {
    const nombreEl = document.getElementById("tecnico-recomendado");
    const justEl = document.getElementById("tecnico-justificacion");

    if (!asignacion) {
      nombreEl.textContent = "Sin asignación propuesta.";
      justEl.textContent = "";
      return;
    }

    const tecnico = asignacion.tecnicos || {};
    const nombre = tecnico.nombre || "Técnico sin nombre";
    const recomendadas = asignacion.recomendada_por_reglas
      ? " (recomendado por el motor de reglas)"
      : " (asignación manual)";
    nombreEl.textContent = nombre + recomendadas;

    const especialidades = Array.isArray(tecnico.especialidades)
      ? tecnico.especialidades.join(", ")
      : "";
    let texto = asignacion.justificacion || "";
    if (especialidades) {
      texto = (texto ? texto + " | " : "") + "Especialidades: " + especialidades;
    }
    justEl.textContent = texto;
  }

  async function cargarDetalle() {
    casoId = obtenerIdCaso();
    if (!casoId) {
      mostrarError("Falta el identificador del caso.");
      return;
    }

    try {
      const respuesta = await fetch(
        "/api/casos/" + encodeURIComponent(casoId),
        { headers: { Authorization: "Bearer " + token() } },
      );

      if (respuesta.status === 401) {
        window.location.href = "index.html";
        return;
      }

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        mostrarError(datos.error || "No se pudo cargar el caso.");
        return;
      }

      casoActual = datos;
      ocultarError();

      const caso = datos.caso || {};
      pintarPrioridad(caso.prioridad);
      pintarSemaforo(caso.color_semaforo);
      set("caso-estado", caso.estado);
      set(
        "caso-tiempo",
        caso.tiempo_maximo_atencion_horas == null
          ? "—"
          : caso.tiempo_maximo_atencion_horas + " h",
      );
      set(
        "caso-brote",
        caso.es_posible_brote ? "Posible brote" : "No",
      );
      set(
        "caso-duplicado",
        caso.es_posible_duplicado ? "Posible duplicado" : "No",
      );

      pintarReporte(datos.reporte);
      pintarInterpretacion(datos.interpretacion);
      pintarAsignacion(datos.asignacion);
    } catch (e) {
      mostrarError("No se pudo contactar al servidor.");
    }
  }

  async function cargarTecnicos() {
    try {
      const respuesta = await fetch("/api/tecnicos", {
        headers: { Authorization: "Bearer " + token() },
      });
      if (!respuesta.ok) {
        return;
      }
      const datos = await respuesta.json();
      tecnicos = datos.tecnicos || [];

      selectorTecnico.innerHTML = "";
      for (const tecnico of tecnicos) {
        const opcion = document.createElement("option");
        opcion.value = tecnico.id;
        const especialidades = Array.isArray(tecnico.especialidades)
          ? " — " + tecnico.especialidades.join(", ")
          : "";
        opcion.textContent =
          `${tecnico.nombre} (${tecnico.casos_activos}/${tecnico.capacidad_maxima_casos})${especialidades}`;
        selectorTecnico.appendChild(opcion);
      }
    } catch (e) {
      // No crítico
    }
  }

  async function aprobar() {
    if (!casoId) {
      return;
    }
    botonAprobar.disabled = true;
    try {
      const respuesta = await fetch(
        "/api/casos/" + encodeURIComponent(casoId) + "/aprobar",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token(),
          },
          body: JSON.stringify({ comentario: comentario.value || null }),
        },
      );
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        pintarResultado(datos.error || "No se pudo aprobar.", true);
        return;
      }
      pintarResultado("Caso aprobado correctamente.", false);
      setTimeout(function () {
        window.location.href = "casos.html";
      }, 800);
    } catch (e) {
      pintarResultado("No se pudo contactar al servidor.", true);
    } finally {
      botonAprobar.disabled = false;
    }
  }

  function mostrarSelectorTecnicos() {
    if (tecnicos.length === 0) {
      cargarTecnicos().then(function () {
        seccionTecnicos.hidden = false;
      });
    } else {
      seccionTecnicos.hidden = false;
    }
  }

  async function confirmarCambioTecnico() {
    if (!casoId) {
      return;
    }
    const tecnicoId = selectorTecnico.value;
    if (!tecnicoId) {
      pintarResultado("Selecciona un técnico.", true);
      return;
    }
    confirmarCambio.disabled = true;
    try {
      const respuesta = await fetch(
        "/api/casos/" + encodeURIComponent(casoId) + "/cambiar-tecnico",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token(),
          },
          body: JSON.stringify({
            tecnico_id: tecnicoId,
            comentario: comentario.value || null,
          }),
        },
      );
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        pintarResultado(datos.error || "No se pudo cambiar el técnico.", true);
        return;
      }
      pintarResultado("Técnico cambiado correctamente.", false);
      setTimeout(function () {
        window.location.href = "casos.html";
      }, 800);
    } catch (e) {
      pintarResultado("No se pudo contactar al servidor.", true);
    } finally {
      confirmarCambio.disabled = false;
    }
  }

  botonAprobar.addEventListener("click", aprobar);
  botonCambiar.addEventListener("click", mostrarSelectorTecnicos);
  confirmarCambio.addEventListener("click", confirmarCambioTecnico);
  cancelarCambio.addEventListener("click", function () {
    seccionTecnicos.hidden = true;
  });

  salir.addEventListener("click", async function () {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { Authorization: "Bearer " + token() },
      });
    } catch (e) {
      // Ignorar errores de logout
    }
    sessionStorage.removeItem("coordinador_token");
    window.location.href = "index.html";
  });

  cargarDetalle();
})();
