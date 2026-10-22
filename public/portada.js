'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  function pintar(id, valor) {
    const el = $(id);
    if (el) el.textContent = valor == null ? '—' : String(valor);
  }

  async function cargar() {
    try {
      const res = await fetch('/api/portal/resumen', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      pintar('kCasos', d.casos);
      pintar('kProductores', d.productores);
      pintar('kParcelas', d.parcelas);
      pintar('kTecnicos', d.tecnicos);
      const punto = $('estadoPunto');
      if (punto) punto.classList.add('punto--ok');
      const texto = $('estadoTexto');
      if (texto) texto.textContent = 'Sistema en línea';
    } catch {
      const texto = $('estadoTexto');
      if (texto) texto.textContent = 'No se pudo consultar el estado del sistema';
    }
  }

  cargar();
})();
