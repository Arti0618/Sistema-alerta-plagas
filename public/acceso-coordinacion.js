'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const error = $('error');

  fetch('/api/sesion', { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((s) => {
      if (s.autenticado && (s.rol === 'coordinador' || s.rol === 'tecnico')) {
        location.replace('/coordinacion');
      }
    })
    .catch(() => {});

  $('formCoord').addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const password = $('password').value;
    if (!password) {
      error.textContent = 'Escribe la contraseña.';
      error.hidden = false;
      return;
    }
    $('btnEntrar').disabled = true;
    try {
      const r = await fetch('/api/coordinacion/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        location.replace('/coordinacion');
        return;
      }
      const d = await r.json().catch(() => ({}));
      error.textContent = d.error || 'Credenciales inválidas.';
      error.hidden = false;
    } catch {
      error.textContent = 'No se pudo conectar con el servidor.';
      error.hidden = false;
    } finally {
      $('btnEntrar').disabled = false;
      $('password').value = '';
    }
  });
})();
