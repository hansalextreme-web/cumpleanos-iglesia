// ═══════════════════════════════════════════════════════════════
//  index.js – Directorio de Cumpleaños · Iglesia Aposento Alto
//  Persistencia: Firebase Firestore (compartido) + localStorage (caché)
// ═══════════════════════════════════════════════════════════════

import { directorioIglesia, transformarDirectorio } from './directorio.js';

// ─── Firebase (CDN ESM) ───────────────────────────────────────
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs,
         doc, setDoc, deleteDoc, writeBatch,
         getDoc }                                 from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signOut,
         onAuthStateChanged }                     from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCIhq8OkpOLx4cHmIWDEQEF3lHA7F-yS2g",
  authDomain:        "cumpleanos-iglesia.firebaseapp.com",
  projectId:         "cumpleanos-iglesia",
  storageBucket:     "cumpleanos-iglesia.firebasestorage.app",
  messagingSenderId: "87953123323",
  appId:             "1:87953123323:web:d7986f67e850e2161e4d5e"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
const COL  = 'miembros';
const COL_ADMINS = 'admind'; // colección con emails autorizados

// ─── Estado global ───────────────────────────────────────────
const STORAGE_KEY  = 'cumpleanosIglesia_v2';
let personas       = [];
let filtroActivo   = null;
let indiceEditando = -1;
let esAdmin        = false; // rol del usuario actual

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  iniciarBarraCarga();
  await cargarDesdeFirestore();
  completarBarraCarga();
  mostrarBannerCumpleanos();
  el('filtroMes').value = String(new Date().getMonth() + 1);
  renderizarLista();
  actualizarDashboard();
  registrarEventos();
  iniciarAuth(); // inicia listener de sesión
});

// ─── Banner de cumpleaños ─────────────────────────────────────
function mostrarBannerCumpleanos() {
  const hoy   = new Date();
  const dHoy  = hoy.getDate();
  const mHoy  = hoy.getMonth() + 1;

  const cumpleHoy = personas.filter(p => p.dia === dHoy && p.mes === mHoy);
  if (cumpleHoy.length === 0) return;

  // Mostrar nombres
  const contenedor = el('bannerNombres');
  contenedor.innerHTML = cumpleHoy.map(p =>
    `<span class="banner-cumple__chip">🎉 ${p.nombre}</span>`
  ).join('');

  // Mostrar banner
  const banner = el('bannerCumple');
  banner.style.display = 'block';

  // Botón cerrar
  el('bannerClose').addEventListener('click', () => {
    banner.style.opacity = '0';
    banner.style.transition = 'opacity .3s ease';
    setTimeout(() => { banner.style.display = 'none'; }, 300);
  });

  // Generar confetti animado
  generarConfetti();
}

function generarConfetti() {
  const cont   = el('confetti');
  const colores = ['#fff', '#ffe066', '#ffb3b3', '#b3e6ff', '#b3ffcc', '#ffcc99'];
  const total  = 28;

  for (let i = 0; i < total; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left       = Math.random() * 100 + '%';
    p.style.background = colores[Math.floor(Math.random() * colores.length)];
    p.style.width      = (6 + Math.random() * 6) + 'px';
    p.style.height     = (6 + Math.random() * 6) + 'px';
    p.style.animationDuration  = (1.5 + Math.random() * 2) + 's';
    p.style.animationDelay     = (Math.random() * 2) + 's';
    p.style.borderRadius       = Math.random() > 0.5 ? '50%' : '2px';
    cont.appendChild(p);
  }
}


// ─── Autenticación Google ─────────────────────────────────────
async function verificarAdmin(email) {
  try {
    const snap = await getDoc(doc(db, COL_ADMINS, email));
    return snap.exists();
  } catch { return false; }
}

function aplicarRol(admin) {
  esAdmin = admin;
  const btnsAdmin = document.querySelectorAll('.solo-admin');
  btnsAdmin.forEach(b => b.style.display = admin ? '' : 'none');
  // Clase en body para CSS condicional (cursor editable, tooltip, etc.)
  document.body.classList.toggle('is-admin', admin);
  const roleEl = el('userRole');
  if (roleEl) {
    roleEl.textContent = admin ? 'Administrador' : 'Solo lectura';
    roleEl.className   = 'user-badge__role ' + (admin ? 'user-badge__role--admin' : 'user-badge__role--viewer');
  }
  renderizarLista();
}

function iniciarAuth() {
  onAuthStateChanged(auth, async usuario => {
    if (usuario) {
      const admin = await verificarAdmin(usuario.email);
      el('btnLogin').style.display  = 'none';
      el('userBadge').style.display = '';
      el('userName').textContent    = usuario.displayName || usuario.email;
      el('userAvatar').src          = usuario.photoURL || '';
      aplicarRol(admin);
    } else {
      el('btnLogin').style.display  = '';
      el('userBadge').style.display = 'none';
      aplicarRol(false);
    }
  });

  el('btnLogin').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error('Auth error:', err.code, err.message);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        return; // usuario cerró el popup — no es un error real
      }
      // Mostrar mensaje específico según el código de error
      const mensajes = {
        'auth/popup-blocked':              '🔒 El navegador bloqueó el popup. Permite popups para este sitio.',
        'auth/unauthorized-domain':        '🌐 Dominio no autorizado en Firebase. Agrégalo en Authentication → Dominios.',
        'auth/operation-not-allowed':      '⚙️ Google Sign-in no está habilitado en Firebase.',
        'auth/network-request-failed':     '📡 Sin conexión. Verifica tu internet.',
        'auth/internal-error':             '⚠️ Error interno de Firebase. Intenta de nuevo.',
      };
      const msg = mensajes[err.code] || `❌ Error: ${err.code || err.message}`;
      toast(msg, 6000);
    }
  });

  el('btnLogout').addEventListener('click', async () => {
    await signOut(auth);
    toast('👋 Sesión cerrada.');
  });
}

// Timeout: si Firestore no responde en 8s, usa datos locales
function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function cargarDesdeFirestore() {
  try {
    const snap = await conTimeout(getDocs(collection(db, COL)), 8000);

    if (snap.empty) {
      toast('⏳ Primera carga: subiendo directorio a la nube…');
      const base = transformarDirectorio(directorioIglesia);
      await subirLoteAFirestore(base);
      personas = base;
      toast('✅ Directorio cargado en la nube correctamente.');
    } else {
      personas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(personas));

  } catch (err) {
    const esTimeout = err.message === 'timeout';
    console.warn(esTimeout ? 'Firestore tardó demasiado, usando caché local.' : 'Error Firestore:', err);
    toast(esTimeout
      ? '⚠️ Sin conexión a la nube. Mostrando datos locales.'
      : '⚠️ Error al conectar con Firebase. Mostrando datos locales.');

    // Fallback: localStorage → directorio.js
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (guardado) {
      try { personas = JSON.parse(guardado); return; } catch { /* sigue */ }
    }
    personas = transformarDirectorio(directorioIglesia);
  }
}

// ─── Firestore: subir lote inicial ────────────────────────────
async function subirLoteAFirestore(lista) {
  // Firestore admite máximo 500 ops por batch
  const CHUNK = 400;
  for (let i = 0; i < lista.length; i += CHUNK) {
    const batch = writeBatch(db);
    lista.slice(i, i + CHUNK).forEach(p => {
      const ref = doc(collection(db, COL));
      const datos = limpiarParaFirestore(p);
      batch.set(ref, datos);
      p.id = ref.id; // guardar el id generado
    });
    await batch.commit();
  }
}

// ─── Firestore: guardar un miembro ───────────────────────────
async function guardarEnFirestore(persona) {
  const datos = limpiarParaFirestore(persona);
  if (persona.id) {
    await setDoc(doc(db, COL, persona.id), datos);
  } else {
    const ref = doc(collection(db, COL));
    await setDoc(ref, datos);
    persona.id = ref.id;
  }
}

// ─── Firestore: eliminar un miembro ──────────────────────────
async function eliminarDeFirestore(id) {
  if (!id) return;
  await deleteDoc(doc(db, COL, id));
}

// Quita el campo 'id' antes de escribir (no lo guardamos dentro del doc)
function limpiarParaFirestore(p) {
  const { id, ...datos } = p;
  // Reemplazar null/undefined por string vacío para evitar errores en Firestore
  Object.keys(datos).forEach(k => {
    if (datos[k] === null || datos[k] === undefined) datos[k] = '';
  });
  return datos;
}

// ─── localStorage: caché ──────────────────────────────────────
function persistirLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personas));
}

function ordenar() {
  personas.sort((a, b) => a.mes !== b.mes ? a.mes - b.mes : a.dia - b.dia);
}

// ─── Dashboard ────────────────────────────────────────────────
function actualizarDashboard(lista = personas) {
  const hoy  = new Date();
  const dHoy = hoy.getDate();
  const mHoy = hoy.getMonth() + 1;
  const mSig = mHoy === 12 ? 1 : mHoy + 1;

  const contHoy    = lista.filter(p => p.dia === dHoy && p.mes === mHoy).length;
  const contMes    = lista.filter(p => p.mes === mHoy).length;
  const contProx7  = lista.filter(p => diasHasta(p) >= 0 && diasHasta(p) <= 7).length;
  const contSigMes = lista.filter(p => p.mes === mSig).length;

  const cnt = Array(13).fill(0);
  personas.forEach(p => { if (p.mes >= 1 && p.mes <= 12) cnt[p.mes]++; });
  const max    = Math.max(...cnt.slice(1));
  const idxMax = cnt.indexOf(max);

  setText('totalMiembros', lista.length);
  setText('hoy',           contHoy);
  setText('esteMes',       contMes);
  setText('proximos7',     contProx7);
  setText('proximoMes',    contSigMes);
  setText('mesMas',        max > 0 ? MESES[idxMax] : '—');
}

function diasHasta(p) {
  const hoy  = new Date();
  let bday   = new Date(hoy.getFullYear(), p.mes - 1, p.dia);
  if (bday < hoy && !(p.dia === hoy.getDate() && p.mes === hoy.getMonth() + 1)) {
    bday.setFullYear(hoy.getFullYear() + 1);
  }
  return Math.round((bday - hoy) / 86400000);
}

// ─── Render tabla ─────────────────────────────────────────────
function obtenerFiltrados() {
  const query  = el('buscador').value.trim().toLowerCase();
  const mesVal = parseInt(el('filtroMes').value, 10);
  const hoy    = new Date();
  const dHoy   = hoy.getDate();
  const mHoy   = hoy.getMonth() + 1;

  let lista = personas;

  if (filtroActivo === 'hoy') {
    lista = lista.filter(p => p.dia === dHoy && p.mes === mHoy);
  } else if (filtroActivo === 'proximos7') {
    lista = lista.filter(p => diasHasta(p) >= 0 && diasHasta(p) <= 7);
  }

  if (mesVal > 0) lista = lista.filter(p => p.mes === mesVal);

  if (query) {
    const mesesNorm = MESES.map(m => m.toLowerCase());
    lista = lista.filter(p => {
      const fields = [
        p.nombre, p.profesion, p.correo, p.direccion, p.telefono,
        `${p.dia} de ${mesesNorm[p.mes] || ''}`,
        `${p.dia}/${p.mes}`
      ].map(v => (v || '').toLowerCase());
      return fields.some(f => f.includes(query));
    });
  }

  return lista;
}

function renderizarLista() {
  const lista  = obtenerFiltrados();
  const tbody  = el('cardsContainer');
  const mobile = el('mobileCards');
  const empty  = el('emptyState');
  const table  = el('membersTable');

  tbody.innerHTML  = '';
  mobile.innerHTML = '';

  if (lista.length === 0) {
    empty.style.display = 'block';
    table.style.display = 'none';
    actualizarDashboard(lista);
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';

  // Ordenar por días restantes de menor a mayor
  const ordenada = [...lista].sort((a, b) => diasHasta(a) - diasHasta(b));

  ordenada.forEach(persona => {
    const idx = personas.indexOf(persona);
    tbody.appendChild(crearFila(persona, idx));       // tabla escritorio
    mobile.appendChild(crearCardMovil(persona, idx)); // card móvil
  });

  actualizarDashboard(lista);
}

function crearCardMovil(p, idx) {
  const dias      = diasHasta(p);
  const esHoy     = dias === 0;
  const pronto    = dias > 0 && dias <= 7;
  const pillClass = esHoy ? 'dias-pill--hoy' : pronto ? 'dias-pill--pronto' : 'dias-pill--normal';
  const pillText  = esHoy ? '🎂 Hoy' : `${dias}d`;
  const fecha     = p.anio ? `${p.dia} ${MESES[p.mes]} ${p.anio}` : `${p.dia} ${MESES[p.mes]}`;

  const div = document.createElement('div');
  div.className = 'm-card' + (esHoy ? ' m-card--hoy' : pronto ? ' m-card--pronto' : '');
  div.innerHTML = `
    <div class="m-card__top">
      <span class="m-card__name">${p.nombre}</span>
      <span class="dias-pill ${pillClass}">${pillText}</span>
    </div>
    <div class="m-card__info">
      <span>🎂 ${fecha}</span>
      ${p.telefono ? `<span>📞 ${p.telefono}</span>` : ''}
      ${p.profesion ? `<span>💼 ${p.profesion}</span>` : ''}
      ${p.correo    ? `<span>✉️ ${p.correo}</span>`    : ''}
    </div>
    ${esAdmin ? `
    <div class="m-card__actions">
      <button class="btn btn--sm btn--outline" data-action="editar"   data-idx="${idx}">✏️ Editar</button>
      <button class="btn btn--sm btn--danger"  data-action="eliminar" data-idx="${idx}">🗑 Eliminar</button>
    </div>` : ''}
  `;
  if (esAdmin) {
    div.querySelector('[data-action="editar"]').addEventListener('click',   () => abrirModal(idx));
    div.querySelector('[data-action="eliminar"]').addEventListener('click', () => confirmarEliminar(idx));
  }
  return div;
}

function crearFila(p, idx) {
  const dias      = diasHasta(p);
  const esHoy     = dias === 0;
  const pronto    = dias > 0 && dias <= 7;
  const pillClass = esHoy ? 'dias-pill--hoy' : pronto ? 'dias-pill--pronto' : 'dias-pill--normal';
  const pillText  = esHoy ? '🎂 Hoy' : `${dias}d`;
  const fecha     = p.anio ? `${p.dia} ${MESES[p.mes]} ${p.anio}` : `${p.dia} ${MESES[p.mes]}`;

  const tr = document.createElement('tr');
  tr.className = esHoy ? 'row--hoy' : pronto ? 'row--pronto' : '';
  tr.innerHTML = `
    <td class="col-dias"><span class="dias-pill ${pillClass}">${pillText}</span></td>
    <td class="col-nombre editable" data-field="nombre"   data-idx="${idx}">${p.nombre}</td>
    <td>${fecha}</td>
    <td class="col-contacto editable" data-field="telefono"  data-idx="${idx}">${p.telefono  || '—'}</td>
    <td class="col-contacto editable" data-field="profesion" data-idx="${idx}">${p.profesion || '—'}</td>
    <td class="col-acciones">
      ${esAdmin ? `
        <button class="btn btn--sm btn--outline" data-action="editar"   data-idx="${idx}">✏️</button>
        <button class="btn btn--sm btn--danger"  data-action="eliminar" data-idx="${idx}">🗑</button>
      ` : '<span style="color:var(--gris-300);font-size:12px">—</span>'}
    </td>
  `;

  if (esAdmin) {
    tr.querySelector('[data-action="editar"]').addEventListener('click',   e => abrirModal(parseInt(e.currentTarget.dataset.idx, 10)));
    tr.querySelector('[data-action="eliminar"]').addEventListener('click', e => confirmarEliminar(parseInt(e.currentTarget.dataset.idx, 10)));
  }
  return tr;
}

// ─── Edición inline ───────────────────────────────────────────
async function editarCeldaInline(celda, idx, campo) {
  if (!esAdmin) return;
  if (celda.querySelector('input')) return; // ya está editando

  const persona     = personas[idx];
  const valorActual = persona[campo] || '';
  const esVacio     = valorActual === '—' || valorActual === '';

  celda.innerHTML = `<input class="inline-input" value="${esVacio ? '' : valorActual}" placeholder="${campo}" />`;
  const input = celda.querySelector('input');
  input.focus();
  input.select();

  let guardado = false;

  async function guardarCambio() {
    if (guardado) return;
    guardado = true;

    const nuevoValor = input.value.trim() || null;
    const sinCambio  = (nuevoValor || '') === (valorActual === '—' ? '' : valorActual);

    if (sinCambio) {
      celda.textContent = valorActual || '—';
      return;
    }

    persona[campo]    = nuevoValor;
    celda.textContent = nuevoValor || '—';

    // Actualizar también la card móvil si existe
    actualizarCardMovil(idx);

    try {
      await guardarEnFirestore(persona);
      persistirLocal();
      toast(`✏️ ${campo.charAt(0).toUpperCase() + campo.slice(1)} actualizado.`);
    } catch (err) {
      console.error(err);
      // Revertir en caso de error
      persona[campo]    = esVacio ? null : valorActual;
      celda.textContent = valorActual || '—';
      toast('❌ Error al guardar. Intenta de nuevo.');
    }
  }

  input.addEventListener('blur', guardarCambio);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
    if (e.key === 'Escape') {
      guardado = true; // evitar que blur guarde
      celda.textContent = valorActual || '—';
    }
  });
}

// Actualiza el texto de una card móvil sin re-renderizar toda la lista
function actualizarCardMovil(idx) {
  const p = personas[idx];
  const mobile = el('mobileCards');
  if (!mobile) return;
  // Buscar la card que tenga un botón con este idx
  const btn = mobile.querySelector(`[data-idx="${idx}"]`);
  if (!btn) return;
  const card = btn.closest('.m-card');
  if (!card) return;
  // Actualizar nombre
  const nameEl = card.querySelector('.m-card__name');
  if (nameEl) nameEl.textContent = p.nombre;
  // Actualizar info
  const infoEl = card.querySelector('.m-card__info');
  if (infoEl) {
    const fecha = p.anio ? `${p.dia} ${MESES[p.mes]} ${p.anio}` : `${p.dia} ${MESES[p.mes]}`;
    infoEl.innerHTML = `
      <span>🎂 ${fecha}</span>
      ${p.telefono ? `<span>📞 ${p.telefono}</span>` : ''}
      ${p.profesion ? `<span>💼 ${p.profesion}</span>` : ''}
      ${p.correo    ? `<span>✉️ ${p.correo}</span>`    : ''}
    `;
  }
}

// ─── CRUD – Modal ─────────────────────────────────────────────
function abrirModal(idx = -1) {
  indiceEditando = idx;
  const esNuevo  = idx === -1;
  el('modalTitle').textContent  = esNuevo ? 'Agregar persona' : 'Editar persona';
  el('btnGuardar').textContent  = esNuevo ? 'Agregar' : 'Guardar cambios';
  el('formError').style.display = 'none';

  if (esNuevo) {
    limpiarFormulario();
  } else {
    const p = personas[idx];
    el('fNombre').value    = p.nombre    || '';
    el('fDia').value       = p.dia       || '';
    el('fMes').value       = p.mes       || '';
    el('fAnio').value      = p.anio      || '';
    el('fTelefono').value  = p.telefono  || '';
    el('fDireccion').value = p.direccion || '';
    el('fProfesion').value = p.profesion || '';
    el('fCorreo').value    = p.correo    || '';
  }

  el('modal').style.display = 'flex';
  setTimeout(() => el('modal').classList.add('modal--visible'), 10);
  el('fNombre').focus();
}

function cerrarModal() {
  el('modal').classList.remove('modal--visible');
  setTimeout(() => { el('modal').style.display = 'none'; }, 200);
}

function limpiarFormulario() {
  ['fNombre','fDia','fMes','fAnio','fTelefono','fDireccion','fProfesion','fCorreo']
    .forEach(id => { el(id).value = ''; });
}

async function guardar() {
  if (!esAdmin) return toast('🔒 Debes iniciar sesión como administrador.');
  const nombre    = el('fNombre').value.trim();
  const dia       = parseInt(el('fDia').value, 10);
  const mes       = parseInt(el('fMes').value, 10);
  const anio      = parseInt(el('fAnio').value, 10)  || null;
  const telefono  = el('fTelefono').value.trim()     || null;
  const direccion = el('fDireccion').value.trim()    || null;
  const profesion = el('fProfesion').value.trim()    || null;
  const correo    = el('fCorreo').value.trim()       || null;

  if (!nombre)                    return mostrarError('El nombre es obligatorio.');
  if (!dia || dia < 1 || dia > 31) return mostrarError('Ingresa un día válido (1-31).');
  if (!mes || mes < 1 || mes > 12) return mostrarError('Selecciona un mes.');

  el('btnGuardar').disabled    = true;
  el('btnGuardar').textContent = '⏳ Guardando…';

  try {
    if (indiceEditando === -1) {
      const nuevo = { nombre, dia, mes, anio, telefono, direccion, profesion, correo };
      await guardarEnFirestore(nuevo);
      personas.push(nuevo);
      toast('✅ Persona agregada.');
    } else {
      const actualizado = { ...personas[indiceEditando], nombre, dia, mes, anio, telefono, direccion, profesion, correo };
      await guardarEnFirestore(actualizado);
      personas[indiceEditando] = actualizado;
      toast('✏️ Cambios guardados.');
    }

    ordenar();
    persistirLocal();
    cerrarModal();
    renderizarLista();
  } catch (err) {
    console.error(err);
    mostrarError('Error al guardar. Revisa tu conexión.');
  } finally {
    el('btnGuardar').disabled = false;
  }
}

function mostrarError(msg) {
  const err = el('formError');
  err.textContent    = msg;
  err.style.display  = 'block';
}

async function confirmarEliminar(idx) {
  if (!esAdmin) return toast('🔒 Debes iniciar sesión como administrador.');
  const p = personas[idx];
  if (!confirm(`¿Eliminar a ${p.nombre}?\nEsta acción no se puede deshacer.`)) return;
  try {
    await eliminarDeFirestore(p.id);
    personas.splice(idx, 1);
    persistirLocal();
    renderizarLista();
    toast('🗑 Persona eliminada.');
  } catch (err) {
    console.error(err);
    toast('❌ Error al eliminar. Revisa tu conexión.');
  }
}

// ─── Importador Excel ─────────────────────────────────────────
function importarExcel(archivo) {
  mostrarProgreso('Leyendo archivo…', 15);
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      mostrarProgreso('Procesando datos…', 40);
      const data  = new Uint8Array(e.target.result);
      const wb    = XLSX.read(data, { type: 'array' });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let idxHeader = -1, colNombres = -1, colApellidos = -1;
      let colTel = -1, colDir = -1, colProf = -1, colCumple = -1, colCorreo = -1;

      for (let i = 0; i < Math.min(filas.length, 20); i++) {
        const fila  = filas[i].map(c => norm(c));
        const iNom  = fila.findIndex(h => h.includes('nombre'));
        const iApe  = fila.findIndex(h => h.includes('apellido'));
        const iCum  = fila.findIndex(h => h.includes('cumple') || h.includes('nacimiento') || h.includes('fecha'));
        if (iNom !== -1 && iCum !== -1) {
          idxHeader    = i;
          colNombres   = iNom;
          colApellidos = iApe;
          colCumple    = iCum;
          colTel    = fila.findIndex(h => h.includes('tel') || h.includes('fono') || h.includes('celular'));
          colDir    = fila.findIndex(h => h.includes('direcc'));
          colProf   = fila.findIndex(h => h.includes('profes') || h.includes('ocup'));
          colCorreo = fila.findIndex(h => h.includes('correo') || h.includes('email') || h.includes('mail'));
          break;
        }
      }

      if (idxHeader === -1) {
        ocultarProgreso();
        return alert('No se encontró fila de encabezados. El archivo debe tener columnas "NOMBRES" y "CUMPLEAÑOS".');
      }

      mostrarProgreso('Importando registros…', 65);
      let agregados = 0, duplicados = 0, erroneos = 0;
      const nuevos = [];

      for (let i = idxHeader + 1; i < filas.length; i++) {
        const fila = filas[i];
        if (!fila || fila.every(c => c === '')) continue;

        let nombre = (fila[colNombres] || '').toString().trim();
        if (colApellidos !== -1) {
          const ape = (fila[colApellidos] || '').toString().trim();
          if (ape) nombre += (nombre ? ' ' : '') + ape;
        }
        if (!nombre) continue;

        let dia, mes, anio = null;
        const valorFecha = colCumple !== -1 ? fila[colCumple] : null;
        if (typeof valorFecha === 'number' && valorFecha > 0) {
          const f = serialExcelAFecha(valorFecha);
          dia = f.dia; mes = f.mes; anio = f.anio;
        } else if (valorFecha) {
          const f = parsearFechaTexto(valorFecha.toString());
          if (f) { dia = f.dia; mes = f.mes; anio = f.anio; }
        }

        if (!dia || !mes || dia < 1 || dia > 31 || mes < 1 || mes > 12) { erroneos++; continue; }

        const existe = personas.some(p =>
          p.nombre.toLowerCase() === nombre.toLowerCase() && p.dia === dia && p.mes === mes
        );
        if (existe) { duplicados++; continue; }

        nuevos.push({
          nombre, dia, mes, anio,
          telefono : colTel    !== -1 ? limpiarTel(fila[colTel])  : null,
          direccion: colDir    !== -1 ? str(fila[colDir])         : null,
          profesion: colProf   !== -1 ? str(fila[colProf])        : null,
          correo   : colCorreo !== -1 ? str(fila[colCorreo])      : null,
        });
        agregados++;
      }

      if (nuevos.length > 0) {
        mostrarProgreso('Guardando en la nube…', 85);
        await subirLoteAFirestore(nuevos);
        personas.push(...nuevos);
      }

      ordenar();
      persistirLocal();
      renderizarLista();
      mostrarProgreso('¡Importación completa!', 100);
      setTimeout(ocultarProgreso, 1500);
      toast(`✅ ${agregados} agregados · ${duplicados} duplicados · ${erroneos} inválidos`);

    } catch (err) {
      console.error(err);
      ocultarProgreso();
      alert('Error al procesar el archivo.');
    }
  };
  reader.readAsArrayBuffer(archivo);
}

// ─── Exportar CSV ─────────────────────────────────────────────
function exportarCSV() {
  if (!personas.length) return alert('No hay datos para exportar.');
  const filas = [
    ['Nombre','Día','Mes','Año','Teléfono','Dirección','Profesión','Correo'],
    ...personas.map(p => [
      p.nombre, p.dia, MESES[p.mes] || '', p.anio || '',
      p.telefono || '', p.direccion || '', p.profesion || '', p.correo || ''
    ])
  ];
  const csv  = filas.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'Cumpleaños_Aposento_Alto.csv';
  a.click();
  toast('⬇ Archivo descargado.');
}

// ─── Gestión de administradores ───────────────────────────────
async function abrirModalAdmins() {
  el('modalAdmins').style.display = 'flex';
  setTimeout(() => el('modalAdmins').classList.add('modal--visible'), 10);
  el('nuevoAdminEmail').value = '';
  el('adminFormError').style.display = 'none';
  await cargarListaAdmins();
}

function cerrarModalAdmins() {
  el('modalAdmins').classList.remove('modal--visible');
  setTimeout(() => { el('modalAdmins').style.display = 'none'; }, 200);
}

async function cargarListaAdmins() {
  const lista = el('adminsList');
  lista.innerHTML = '<div class="admins-list__loading">⏳ Cargando administradores...</div>';
  
  try {
    const snap = await getDocs(collection(db, COL_ADMINS));
    const admins = snap.docs.map(d => d.id);
    
    if (admins.length === 0) {
      lista.innerHTML = '<div class="admins-list__loading">No hay administradores registrados.</div>';
      return;
    }

    const emailActual = auth.currentUser?.email;
    lista.innerHTML = admins.map(email => `
      <div class="admin-item">
        <span class="admin-item__email">${email}</span>
        ${email === emailActual ? '<span class="admin-item__badge">TÚ</span>' : ''}
        ${email !== emailActual ? `<button class="admin-item__remove" data-email="${email}" title="Eliminar administrador">🗑</button>` : ''}
      </div>
    `).join('');

    // Eventos para eliminar
    lista.querySelectorAll('.admin-item__remove').forEach(btn => {
      btn.addEventListener('click', () => eliminarAdmin(btn.dataset.email));
    });

  } catch (err) {
    console.error('Error al cargar admins:', err);
    lista.innerHTML = '<div class="admins-list__loading" style="color:var(--peligro)">❌ Error al cargar administradores.</div>';
  }
}

async function agregarAdmin() {
  const email = el('nuevoAdminEmail').value.trim().toLowerCase();
  const errorEl = el('adminFormError');
  
  if (!email) {
    errorEl.textContent = 'Ingresa un correo electrónico.';
    errorEl.style.display = 'block';
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Ingresa un correo válido.';
    errorEl.style.display = 'block';
    return;
  }

  errorEl.style.display = 'none';
  el('btnAgregarAdmin').disabled = true;
  el('btnAgregarAdmin').textContent = '⏳ Agregando...';

  try {
    // Verificar si ya existe
    const existe = await getDoc(doc(db, COL_ADMINS, email));
    if (existe.exists()) {
      errorEl.textContent = 'Este correo ya es administrador.';
      errorEl.style.display = 'block';
      return;
    }

    // Agregar a Firestore
    await setDoc(doc(db, COL_ADMINS, email), { rol: 'admin' });
    
    toast(`✅ ${email} agregado como administrador.`);
    el('nuevoAdminEmail').value = '';
    await cargarListaAdmins();

  } catch (err) {
    console.error('Error al agregar admin:', err);
    errorEl.textContent = 'Error al agregar administrador. Revisa tu conexión.';
    errorEl.style.display = 'block';
  } finally {
    el('btnAgregarAdmin').disabled = false;
    el('btnAgregarAdmin').textContent = '+ Agregar';
  }
}

async function eliminarAdmin(email) {
  if (!confirm(`¿Eliminar a ${email} como administrador?\nEsta persona perderá acceso de escritura.`)) return;

  try {
    await deleteDoc(doc(db, COL_ADMINS, email));
    toast(`🗑 ${email} eliminado de administradores.`);
    await cargarListaAdmins();
  } catch (err) {
    console.error('Error al eliminar admin:', err);
    toast('❌ Error al eliminar. Intenta de nuevo.');
  }
}

// ─── Eventos ──────────────────────────────────────────────────
function registrarEventos() {
  el('buscador').addEventListener('input',  () => { filtroActivo = null; renderizarLista(); });
  el('filtroMes').addEventListener('change',() => { filtroActivo = null; renderizarLista(); });

  el('card-total').addEventListener('click', () => {
    filtroActivo = null; el('filtroMes').value = '0'; el('buscador').value = ''; renderizarLista();
  });
  el('card-hoy').addEventListener('click', () => {
    filtroActivo = 'hoy'; el('filtroMes').value = '0'; el('buscador').value = ''; renderizarLista();
  });
  el('card-este-mes').addEventListener('click', () => {
    filtroActivo = null; el('filtroMes').value = String(new Date().getMonth() + 1); el('buscador').value = ''; renderizarLista();
  });
  el('card-proximos-7').addEventListener('click', () => {
    filtroActivo = 'proximos7'; el('filtroMes').value = '0'; el('buscador').value = ''; renderizarLista();
  });

  el('btnNuevo').addEventListener('click',    () => abrirModal(-1));
  el('btnImportar').addEventListener('click', () => el('inputExcel').click());
  el('btnExportar').addEventListener('click', exportarCSV);
  el('inputExcel').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) importarExcel(f);
    e.target.value = '';
  });

  // Gestión de admins
  el('btnGestionarAdmins').addEventListener('click', abrirModalAdmins);
  el('btnAgregarAdmin').addEventListener('click', agregarAdmin);
  el('btnCerrarAdmins').addEventListener('click', cerrarModalAdmins);
  el('modalAdminsClose').addEventListener('click', cerrarModalAdmins);
  el('modalAdminsBackdrop').addEventListener('click', cerrarModalAdmins);
  el('modalAdmins').addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarModalAdmins();
    if (e.key === 'Enter' && e.target.id === 'nuevoAdminEmail') agregarAdmin();
  });

  // ── Edición inline delegada al tbody ──────────────────────────
  // Se registra una vez aquí, funciona para todas las filas actuales y futuras.
  // Verifica esAdmin en tiempo de ejecución, no en tiempo de creación.
  el('cardsContainer').addEventListener('dblclick', e => {
    if (!esAdmin) return;
    const celda = e.target.closest('td.editable');
    if (!celda) return;
    editarCeldaInline(celda, parseInt(celda.dataset.idx, 10), celda.dataset.field);
  });

  el('btnGuardar').addEventListener('click',   guardar);
  el('btnCancelar').addEventListener('click',  cerrarModal);
  el('modalClose').addEventListener('click',   cerrarModal);
  el('modalBackdrop').addEventListener('click',cerrarModal);
  el('modal').addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarModal();
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') guardar();
  });
}

// ─── UI helpers ───────────────────────────────────────────────
let _barraTimers = [];

function iniciarBarraCarga() {
  _barraTimers.forEach(clearTimeout);
  _barraTimers = [];
  el('progressWrap').style.display   = 'block';
  el('progressText').textContent     = 'Cargando directorio…';
  el('progressBar').style.transition = 'none';
  el('progressBar').style.width      = '0%';

  // Mostrar skeleton en la tabla mientras carga
  const tbody = el('cardsContainer');
  const mobile = el('mobileCards');
  if (tbody) {
    tbody.innerHTML = Array(6).fill(0).map(() => `
      <tr class="skeleton-row">
        <td><div class="skeleton s-pill"></div></td>
        <td><div class="skeleton s-name"></div></td>
        <td><div class="skeleton s-date"></div></td>
        <td><div class="skeleton s-tel"></div></td>
        <td><div class="skeleton s-prof"></div></td>
        <td><div class="skeleton s-btns"></div></td>
      </tr>`).join('');
  }
  if (mobile) {
    mobile.innerHTML = Array(4).fill(0).map(() => `
      <div class="m-card" style="gap:10px">
        <div class="skeleton" style="height:16px;width:60%"></div>
        <div class="skeleton" style="height:13px;width:40%"></div>
        <div class="skeleton" style="height:13px;width:80%"></div>
      </div>`).join('');
  }

  // Avanza suavemente mientras espera
  const pasos = [[200,10],[600,30],[1100,50],[1800,65],[2800,75],[4200,83],[6000,90],[8000,95]];
  pasos.forEach(([ms, pct]) => {
    _barraTimers.push(setTimeout(() => {
      if (el('progressWrap').style.display !== 'none') {
        el('progressBar').style.transition = 'width 0.6s ease';
        el('progressBar').style.width = pct + '%';
      }
    }, ms));
  });
}

function completarBarraCarga() {
  _barraTimers.forEach(clearTimeout);
  _barraTimers = [];
  el('progressBar').style.transition = 'width 0.3s ease';
  el('progressBar').style.width      = '100%';
  el('progressText').textContent     = '¡Listo!';
  setTimeout(ocultarProgreso, 400);
}

function mostrarProgreso(texto, pct) {
  el('progressWrap').style.display = 'block';
  el('progressText').textContent   = texto;
  el('progressBar').style.width    = pct + '%';
}
function ocultarProgreso() {
  el('progressWrap').style.display = 'none';
  el('progressBar').style.width    = '0%';
}

let _toastTimer = null;
function toast(msg, duracion = 3500) {
  const t = el('toast');
  t.textContent = msg;
  t.style.display = 'block';
  t.classList.add('toast--visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('toast--visible');
    setTimeout(() => { t.style.display = 'none'; }, 300);
  }, duracion);
}

// ─── Helpers generales ────────────────────────────────────────
function el(id)           { return document.getElementById(id); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function norm(v) {
  return (v || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}
function str(v)     { return v ? v.toString().trim() || null : null; }
function limpiarTel(v) {
  if (!v) return null;
  return v.toString().replace(/\.0$/, '').trim() || null;
}
function serialExcelAFecha(serial) {
  const date = new Date(Math.floor(serial - 25569) * 86400 * 1000);
  return { dia: date.getUTCDate(), mes: date.getUTCMonth() + 1, anio: date.getUTCFullYear() };
}
function parsearFechaTexto(texto) {
  if (!texto) return null;
  const limpia = texto.replace(/\b(de|del)\b/gi,' ').replace(/\s+/g,' ').trim();
  const partes = limpia.split(/[\/.\-\s]+/);
  if (partes.length < 2) return null;
  const MESES_NORM = ['enero','febrero','marzo','abril','mayo','junio',
                      'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const parseMes = v => {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 12) return n;
    const idx = MESES_NORM.findIndex(m => norm(v).startsWith(m.slice(0,3)));
    return idx !== -1 ? idx + 1 : null;
  };
  let dia, mes, anio = null;
  if (partes[0].length === 4) {
    anio = parseInt(partes[0],10); mes = parseMes(partes[1]); dia = parseInt(partes[2],10);
  } else {
    dia = parseInt(partes[0],10); mes = parseMes(partes[1]);
    if (partes[2]) { anio = parseInt(partes[2],10); if (anio < 100) anio += 1900; }
  }
  if (isNaN(dia) || !mes || dia < 1 || dia > 31) return null;
  return { dia, mes, anio };
}
