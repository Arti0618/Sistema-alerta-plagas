(function () {
  "use strict";

  const estado = document.getElementById("estado-carga");
  const tabla = document.getElementById("tabla-casos");
  const cuerpo = document.getElementById("cuerpo-tabla");
  const sinCasos = document.getElementById("sin-casos");
  const refrescar = document.getElementById("boton-refrescar");
  const salir = document.getElementById("boton-salir");

  function token() {
    return sessionStorage.getItem("coordinador_token");
  }

  function claseSemaforo(color) {
    if (color === "verde" || color === "amarillo" || color === "rojo") {
      return color;
    }
    return "";
  }

  function clasePrioridad(valor) {
    if (typeof valor !== "number") {
      return "";
    }
    if (valor >= 70) {
      return "alta";
    }
    if (valor >= 40) {
      return "media";
    }
    return "baja";
  }

  function formatoFecha(iso) {
    if (!iso) {
      return "—";
    }
    try {
      const fecha = new Date(iso);
      return fecha.toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch (e) {
      return iso;
    }
  }

  function resumenReporte(reporte) {
    if (!reporte) {
      return "—";
    }
    const tipo = reporte.tipo_contenido || "—";
    const texto = reporte.mensaje_original || "";
    const recorte = texto.length > 80
      ? texto.slice(0, 80) + "..."
      : texto;
    return `${tipo}: ${recorte || "(sin texto)"}`;
  }

  async function cargar() {
    estado.textContent = "Cargando casos...";
    estado.hidden = false;
    tabla.hidden = true;
    sinCasos.hidden = true;
    cuerpo.innerHTML = "";

    try {
      const respuesta = await fetch("/api/casos", {
        headers: { Authorization: "Bearer " + token() },
      });

      if (respuesta.status === 401) {
        window.location.href = "index.html";
        return;
      }

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        estado.textContent = datos.error || "Error al cargar los casos.";
        return;
      }

      const casos = datos.casos || [];

      if (casos.length === 0) {
        estado.hidden = true;
        sinCasos.hidden = false;
        return;
      }

      estado.hidden = true;
      tabla.hidden = false;

      for (const caso of casos) {
        const fila = document.createElement("tr");
        const prioridad = caso.prioridad;
        const semaforo = caso.color_semaforo;
        const reporte = caso.reportes || {};

        fila.innerHTML = `
          <td>
            <span class="prioridad ${clasePrioridad(prioridad)}">
              ${prioridad == null ? "—" : prioridad}
            </span>
          </td>
          <td>
            <span class="semaforo ${claseSemaforo(semaforo)}">
              ${semaforo || "—"}
            </span>
          </td>
          <td>${formatoFecha(reporte.fecha_recepcion || caso.created_at)}</td>
          <td>${reporte.tipo_contenido || "—"}</td>
          <td>${resumenReporte(reporte)}</td>
          <td>
            <a class="boton primario" href="detalle.html?caso=${encodeURIComponent(caso.id)}">
              Revisar
            </a>
          </td>
        `;
        cuerpo.appendChild(fila);
      }
    } catch (e) {
      estado.textContent = "No se pudo contactar al servidor.";
    }
  }

  refrescar.addEventListener("click", cargar);
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

  cargar();
})();
