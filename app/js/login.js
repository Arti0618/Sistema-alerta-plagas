(function () {
  "use strict";

  const formulario = document.getElementById("formulario-login");
  const error = document.getElementById("error-login");

  function mostrarError(mensaje) {
    error.textContent = mensaje;
    error.hidden = false;
  }

  formulario.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    error.hidden = true;

    const contrasena = document.getElementById("contrasena").value;
    const boton = formulario.querySelector("button");
    boton.disabled = true;

    try {
      const respuesta = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: contrasena }),
      });

      const datos = await respuesta.json();

      if (!respuesta.ok) {
        mostrarError(datos.error || "No fue posible iniciar sesión.");
        return;
      }

      sessionStorage.setItem("coordinador_token", datos.token);
      window.location.href = "casos.html";
    } catch (e) {
      mostrarError("No se pudo contactar al servidor.");
    } finally {
      boton.disabled = false;
    }
  });
})();
