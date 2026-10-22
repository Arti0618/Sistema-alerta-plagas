'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const error = $('error');

  function mostrarError(texto) {
    error.textContent = texto;
    error.hidden = false;
  }

  fetch('/api/sesion', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((s) => {
      if (s.autenticado && s.rol === 'productor') {
        location.replace('/productor');
        return;
      }
      if (s.autenticado) {
        mostrarError('Hay una sesión de coordinación abierta. Cierra sesión para entrar como productor.');
      }
    })
    .catch(() => {});

  $('formProductor').addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const productor_id = $('productor').value.trim();
    const password = $('password').value;
    if (!productor_id || !password) {
      return mostrarError('Escribe tu ID de productor y la contraseña.');
    }
    $('btnEntrar').disabled = true;
    try {
      const r = await fetch('/api/productor/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ productor_id, password }),
      });
      if (r.ok) {
        location.replace('/productor');
        return;
      }
      const d = await r.json().catch(() => ({}));
      mostrarError(d.error || 'ID de productor o contraseña incorrectos.');
    } catch {
      mostrarError('No se pudo conectar con el servidor.');
    } finally {
      $('btnEntrar').disabled = false;
    }
  });
})();
