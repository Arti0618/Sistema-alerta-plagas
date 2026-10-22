'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  let filas = [];

  function escapar(t) {
    const d = document.createElement('div');
    d.textContent = String(t ?? '');
    return d.innerHTML;
  }

  function fecha(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  function chip(s) {
    if (!s) return '<span class="chip chip--neutro">—</span>';
    return `<span class="chip chip--${s}">${s}</span>`;
  }

  function pintar() {
    const q = $('buscar').value.trim().toLowerCase();
    const visibles = filas.filter((f) =>
      [f.folio, f.parcelario, f.cultivo, f.tecnico, f.estado]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
    const cuerpo = $('filas');
    cuerpo.textContent = '';
    if (!visibles.length) {
      cuerpo.innerHTML = '<tr><td colspan="7"><p class="vacio">Sin actividad que coincida.</p></td></tr>';
      return;
    }
    for (const f of visibles.slice(0, 200)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Folio">${escapar(f.folio)}</td>
        <td data-label="Fecha">${fecha(f.fecha)}</td>
        <td data-label="Parcela">${escapar(f.parcelario || '—')}</td>
        <td data-label="Cultivo">${escapar(f.cultivo || '—')}</td>
        <td data-label="Técnico">${escapar(f.tecnico || '—')}</td>
        <td data-label="Semáforo">${chip(f.semaforo)}</td>
        <td data-label="Estado">${escapar(f.estado || '—')}</td>`;
      cuerpo.appendChild(tr);
    }
  }

  function csv() {
    const cab = ['folio', 'fecha', 'parcela', 'cultivo', 'tecnico', 'semaforo', 'estado'];
    const lineas = [cab.join(',')].concat(
      filas.map((f) =>
        [f.folio, f.fecha, f.parcelario, f.cultivo, f.tecnico, f.semaforo, f.estado]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(','),
      ),
    );
    const blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bitacora-alerta-plaga.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $('buscar').addEventListener('input', pintar);
  $('btnCsv').addEventListener('click', csv);
  $('btnSalir').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.replace('/');
  });

  fetch('/api/coordinacion/bitacora', { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      if (r.status === 401) return location.replace('/acceso-coordinacion');
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      filas = d.bitacora || [];
      pintar();
    })
    .catch(() => {
      $('filas').innerHTML = '<tr><td colspan="7"><p class="vacio">No se pudo cargar la bitácora.</p></td></tr>';
    });
})();
