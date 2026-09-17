// ═══════════════════════════════════════════════════════════════
//  index.js – Directorio de Cumpleaños · Iglesia Aposento Alto
//  Persistencia: Firebase Firestore (compartido) + localStorage (caché)
// ═══════════════════════════════════════════════════════════════

import { directorioIglesia, transformarDirectorio } from './directorio.js';

// ─── Firebase (CDN ESM) ───────────────────────────────────────
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs,
         doc, setDoc, deleteDoc, writeBatch,
         getDoc, query, where }               from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, GoogleAuthProvider,
         signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
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
const COL_ADMINS = 'admin'; // colección con emails autorizados (ID = email)

// ─── Estado global ───────────────────────────────────────────
const STORAGE_KEY  = 'cumpleanosIglesia_v2';
let personas       = [];
let filtroActivo   = null;
let indiceEditando = -1;
let esAdmin        = false; // rol del usuario actual
let rolActual      = null;  // 'admin' | 'lector' | 'miembro' | null

// ─── Helpers de autorización de cliente ───────────────────────
// IMPORTANTE: estas funciones son solo para la UI (mostrar/ocultar).
// La línea de defensa real son las Security Rules en firestore.rules.

/** Devuelve true si el usuario tiene rol admin en memoria. */
function clienteEsAdmin() {
  return esAdmin === true;
}

/** Devuelve true si el usuario puede ver el directorio (cualquier rol). */
function puedeLeerDirectorio() {
  return esAdmin === true
      || rolActual === 'lector'
      || rolActual === 'miembro';
}

/**
 * Envuelve una operación Firestore y captura permission-denied.
 * Evita que un error de permisos se propague como excepción no manejada.
 * @param {Promise} promesa   La operación Firestore.
 * @param {string}  contexto  Texto para el log (ej. 'leer miembros').
 * @returns {Promise<any|null>}  El resultado o null si fue denegado.
 */
async function intentarFirestore(promesa, contexto = 'operación') {
  try {
    return await promesa;
  } catch (err) {
    if (err?.code === 'permission-denied') {
      console.warn(`[Firestore] Permiso denegado al ${contexto}.`);
      return null;
    }
    throw err; // otros errores sí se propagan
  }
}

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Registrar eventos primero (incluyendo botón de login)
  registrarEventosLogin();
  // Iniciar auth — cuando el usuario esté logueado y autorizado, se carga todo
  iniciarAuth();
});

// Eventos solo del login (antes de cargar datos)
function registrarEventosLogin() {
  const btnLS = el('btnLoginScreen');
  if (!btnLS) return;

  btnLS.addEventListener('click', () => {
    iniciarSesionConDeteccionMovil();
  });
}

// Función para detectar dispositivos móviles
function esMobile() {
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         window.innerWidth <= 768;
}

// Función de inicio de sesión adaptada para móvil y desktop
async function iniciarSesionConDeteccionMovil() {
  const btnLS = el('btnLoginScreen');
  const errEl = el('loginScreenError');
  
  if (!btnLS) return;

  // Ocultar error anterior
  if (errEl) errEl.style.display = 'none';
  
  // Cambiar botón a estado de carga
  btnLS.disabled = true;
  btnLS.innerHTML = '⏳ Ingresando...';

  try {
    const provider = new GoogleAuthProvider();
    
    if (esMobile()) {
      // Para móviles: usar redirect (no se bloquea)
      await signInWithRedirect(auth, provider);
      // No hay .then() aquí porque la página se redirige
      // El resultado se maneja en iniciarAuth() con getRedirectResult
    } else {
      // Para desktop: usar popup
      await signInWithPopup(auth, provider);
      // onAuthStateChanged se encarga del resto
    }
  } catch (err) {
    console.error('[Login]', err.code, err.message);
    restaurarBotonLogin();
    
    // No mostrar error si el usuario canceló
    if (err.code === 'auth/popup-closed-by-user' || 
        err.code === 'auth/cancelled-popup-request') return;
        
    mostrarErrorLogin(err, errEl);
  }
}

function restaurarBotonLogin() {
  const btnLS = el('btnLoginScreen');
  if (btnLS) {
    btnLS.disabled = false;
    btnLS.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> Ingresar con Google`;
  }
}

function mostrarErrorLogin(err, errEl) {
  if (!errEl) return;
  
  const mensajes = {
    'auth/popup-blocked':        '🔒 El navegador bloqueó el popup. Permite popups para este sitio.',
    'auth/unauthorized-domain':  '🌐 Dominio no autorizado en Firebase.',
    'auth/network-request-failed':'📡 Sin conexión. Verifica tu internet.',
    'auth/internal-error':       '⚠️ Error interno. Intenta de nuevo.',
    'auth/cancelled-popup-request': '❌ Operación cancelada.',
    'auth/web-storage-unsupported': '🔧 Tu navegador no soporta almacenamiento local.',
  };
  
  errEl.textContent = mensajes[err.code] || `❌ Error: ${err.code}`;
  errEl.style.display = 'block';
}

async function cargarApp() {
  iniciarBarraCarga();
  await cargarDesdeFirestore();
  completarBarraCarga();
  mostrarBannerCumpleanos();
  actualizarFaviconDinamico();
  actualizarBadgePWA();
  await pedirPermisoNotificaciones();
  mostrarNotificacionCumpleanos();
  el('filtroMes').value = String(new Date().getMonth() + 1);
  renderizarLista();
  actualizarDashboard();
  registrarEventos();
  mostrarBannerActualizacion();
}

// ─── Banner de cumpleaños ─────────────────────────────────────
function mostrarBannerCumpleanos() {
  const hoy  = new Date();
  const dHoy = hoy.getDate();
  const mHoy = hoy.getMonth() + 1;

  const cumpleHoy = personas.filter(p => p.dia === dHoy && p.mes === mHoy);
  if (cumpleHoy.length === 0) return;

  // Subtítulo según cuántos cumplen
  const subtitulo = cumpleHoy.length === 1
    ? '🎉 ¡Un miembro celebra su cumpleaños hoy!'
    : `🎉 ¡${cumpleHoy.length} miembros celebran su cumpleaños hoy!`;
  el('bannerSubtitulo').textContent = subtitulo;

  // Tarjetas individuales por persona
  const contenedor = el('bannerPersonas');
  contenedor.innerHTML = cumpleHoy.map(p => {
    const inicial  = (p.nombre || '?')[0].toUpperCase();
    const edad     = p.anio ? `${hoy.getFullYear() - p.anio} años` : '';
    const tel      = p.telefono  ? `<span class="bcumple-card__dato">📞 ${p.telefono}</span>`  : '';
    const prof     = p.profesion ? `<span class="bcumple-card__dato">💼 ${p.profesion}</span>` : '';
    return `
      <div class="bcumple-card">
        <div class="bcumple-card__avatar">${inicial}</div>
        <div class="bcumple-card__info">
          <span class="bcumple-card__nombre">${p.nombre}</span>
          ${edad ? `<span class="bcumple-card__edad">🎈 ${edad}</span>` : ''}
          <div class="bcumple-card__datos">${tel}${prof}</div>
        </div>
      </div>`;
  }).join('');

  // Mostrar banner con animación
  const banner = el('bannerCumple');
  banner.style.display = 'block';

  // Botón cerrar
  el('bannerClose').addEventListener('click', () => {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-10px)';
    banner.style.transition = 'opacity .3s ease, transform .3s ease';
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


// ─── Notificaciones locales ──────────────────────────────────

const NOTIF_KEY = 'notif_cumple_fecha'; // localStorage key

async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') return;

  // Esperar 3s para no interrumpir la carga inicial
  await new Promise(r => setTimeout(r, 3000));

  if (Notification.permission !== 'granted') {
    const resultado = await Notification.requestPermission();
    // Si acaba de aceptar, limpiar el flag para mostrar notificación de inmediato
    if (resultado === 'granted') {
      localStorage.removeItem(NOTIF_KEY);
      mostrarNotificacionCumpleanos();
    }
  }
}

function mostrarNotificacionCumpleanos() {
  if (!('Notification' in window)) {
    console.warn('[Notif] Navegador no soporta notificaciones');
    return;
  }
  if (Notification.permission !== 'granted') {
    console.warn('[Notif] Permiso no otorgado:', Notification.permission);
    return;
  }

  const hoy       = new Date();
  const dHoy      = hoy.getDate();
  const mHoy      = hoy.getMonth() + 1;
  const fechaHoy  = `${hoy.getFullYear()}-${mHoy}-${dHoy}`;

  if (localStorage.getItem(NOTIF_KEY) === fechaHoy) {
    console.log('[Notif] Ya se mostró hoy:', fechaHoy);
    return;
  }

  const cumpleHoy = personas.filter(p => p.dia === dHoy && p.mes === mHoy);
  console.log('[Notif] Cumpleañeros hoy:', cumpleHoy.length, cumpleHoy.map(p => p.nombre));

  if (cumpleHoy.length === 0) return;

  // Construir mensaje
  const nombres  = cumpleHoy.map(p => p.nombre.split(' ').slice(0,2).join(' ')).join(', ');
  const titulo   = cumpleHoy.length === 1
    ? `🎂 ¡Hoy cumple años ${cumpleHoy[0].nombre.split(' ')[0]}!`
    : `🎂 ¡${cumpleHoy.length} cumpleaños hoy!`;
  const cuerpo   = cumpleHoy.length === 1
    ? `No olvides felicitar a ${nombres} hoy 💛`
    : `${nombres} cumplen años hoy. ¡Felicítalos! 💛`;

  // Mostrar via Service Worker (funciona con app cerrada)
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(titulo, {
        body:    cuerpo,
        icon:    'logo.png',
        badge:   'icon-maskable.png',
        tag:     'cumpleanos-hoy',        // reemplaza notif anterior del mismo día
        renotify: false,
        vibrate: [200, 100, 200],
        data:    { url: '/' }
      });
    });
  } else {
    // Fallback: notificación directa
    new Notification(titulo, {
      body: cuerpo,
      icon: 'logo.png',
      tag:  'cumpleanos-hoy'
    });
  }

  // Marcar como mostrada hoy
  localStorage.setItem(NOTIF_KEY, fechaHoy);
}

// ─── Badge nativo PWA ────────────────────────────────────────
function actualizarBadgePWA() {
  const hoy       = new Date();
  const cumpleHoy = personas.filter(p => p.dia === hoy.getDate() && p.mes === hoy.getMonth() + 1);

  // Web App Badging API — Chrome Android 81+, Windows Chrome/Edge
  if ('setAppBadge' in navigator) {
    if (cumpleHoy.length > 0) {
      navigator.setAppBadge(cumpleHoy.length).catch(() => {});
    } else {
      navigator.clearAppBadge().catch(() => {});
    }
  }
}

// ─── Favicon dinámico ────────────────────────────────────────
function actualizarFaviconDinamico() {
  const hoy       = new Date();
  const cumpleHoy = personas.filter(p => p.dia === hoy.getDate() && p.mes === hoy.getMonth() + 1);

  // Cambiar título de la pestaña
  if (cumpleHoy.length > 0) {
    const nombres = cumpleHoy.map(p => p.nombre.split(' ')[0]).join(', ');
    document.title = `🎂 ¡Cumpleaños hoy! · Directorio Piedra Viva`;
  }

  // Crear favicon dinámico con canvas
  const canvas  = document.createElement('canvas');
  canvas.width  = 64;
  canvas.height = 64;
  const ctx     = canvas.getContext('2d');

  const img = new Image();
  img.src   = 'logo.png';
  img.onload = () => {
    // Dibujar logo original
    ctx.drawImage(img, 0, 0, 64, 64);

    if (cumpleHoy.length > 0) {
      // Badge rojo en esquina superior derecha
      ctx.beginPath();
      ctx.arc(50, 14, 13, 0, 2 * Math.PI);
      ctx.fillStyle = '#e30613';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Emoji 🎂 o número de cumpleañeros
      ctx.font      = 'bold 14px Arial';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cumpleHoy.length > 9 ? '9+' : String(cumpleHoy.length), 50, 14);
    }

    // Aplicar favicon
    const link = document.querySelector("link[rel='icon']") || document.createElement('link');
    link.rel   = 'icon';
    link.type  = 'image/png';
    link.href  = canvas.toDataURL('image/png');
    document.head.appendChild(link);
  };

  img.onerror = () => {
    // Fallback: solo emoji en el título si no carga la imagen
    if (cumpleHoy.length > 0) {
      document.title = `🎂 ¡Cumpleaños hoy! · Directorio Piedra Viva`;
    }
  };
}

// ─── Banner de actualización de ícono ────────────────────────
const UPDATE_KEY     = 'pwa_update_visto_v1.7';
const ICONO_VERSION  = 'icono_v3'; // incrementar cada vez que cambie el ícono

function mostrarBannerActualizacion() {
  // Si ya vio este aviso, no mostrar de nuevo
  if (localStorage.getItem(UPDATE_KEY) === ICONO_VERSION) return;

  const banner = el('bannerUpdate');
  if (!banner) return;

  banner.style.display = 'block';
  requestAnimationFrame(() => banner.classList.add('banner-update--visible'));

  el('btnUpdateClose').addEventListener('click', () => {
    banner.classList.remove('banner-update--visible');
    setTimeout(() => { banner.style.display = 'none'; }, 350);
    // Recordar que ya fue visto
    localStorage.setItem(UPDATE_KEY, ICONO_VERSION);
  });
}

// ─── Autenticación Google ─────────────────────────────────────

// ─── Verificar si el email tiene acceso al directorio ─────────
// Consulta las 3 colecciones de autorización en paralelo.
// Las rules permiten que cada usuario lea su PROPIO documento en
// admin, lectores y miembros por ID, sin causar permission-denied.
async function verificarAcceso(email) {
  const emailNorm = email.toLowerCase().trim();

  try {
    // 3 lecturas O(1) en paralelo — cada una sobre el propio email del usuario
    const [adminSnap, lectorSnap, miembroSnap] = await Promise.all([
      getDoc(doc(db, 'admin',    emailNorm)),   // ¿es admin?
      getDoc(doc(db, 'lectores', emailNorm)),   // ¿tiene permiso de lector?
      getDoc(doc(db, 'miembros', emailNorm))    // ¿está en el directorio?
    ]);

    if (adminSnap.exists())   return { acceso: true, rol: 'admin'   };
    if (lectorSnap.exists())  return { acceso: true, rol: 'lector'  };
    if (miembroSnap.exists()) return { acceso: true, rol: 'miembro' };

  } catch (err) {
    if (err?.code === 'permission-denied') {
      // Rules bloquearon la lectura — sin acceso, no es un crash
      console.warn('[verificarAcceso] permission-denied para:', emailNorm);
      return { acceso: false, rol: null };
    }
    // Error de red u otro — relanzar para que iniciarAuth muestre el mensaje correcto
    throw err;
  }

  return { acceso: false, rol: null };
}

function mostrarPantallaAccesoDenegado(email) {
  // Ocultar login y app
  const ls = el('loginScreen');
  if (ls) ls.style.display = 'none';
  const app = el('app');
  if (app) app.style.display = 'none';

  // Usar el elemento estático del HTML — mostrar email del usuario
  const pantalla = el('accesoDenegado');
  if (!pantalla) return;

  const emailEl = el('emailDenegado');
  if (emailEl) emailEl.textContent = email;

  pantalla.style.display = 'flex';

  // Conectar botón "Cerrar sesión" (solo una vez)
  const btn = el('btnDenegadoSalir');
  if (btn && !btn._listenerOk) {
    btn.addEventListener('click', () => signOut(auth));
    btn._listenerOk = true;
  }
}

function ocultarPantallaAccesoDenegado() {
  const p = el('accesoDenegado');
  if (p) p.style.display = 'none';
  // No tocar #app aquí — lo gestiona ocultarLoginScreen() al conceder acceso
}

function mostrarLoginScreen() {
  const ls = el('loginScreen');
  if (ls) ls.style.display = 'flex';
  const app = el('app');
  if (app) app.style.display = 'none';
}

function ocultarLoginScreen() {
  const ls = el('loginScreen');
  if (ls) ls.style.display = 'none';
  const app = el('app');
  if (app) app.style.display = '';
}

function mostrarSpinnerLogin(texto = 'Verificando...') {
  // Reutilizar la pantalla de login con estado de carga
  const ls = el('loginScreen');
  if (!ls) return;
  ls.style.display = 'flex';
  const btn  = el('btnLoginScreen');
  const desc = ls.querySelector('.login-screen__desc');
  if (btn)  { btn.disabled = true; btn.innerHTML = `<span class="spinner-btn"></span> ${texto}`; }
  if (desc) desc.textContent = texto;
}

function ocultarSpinnerLogin() {
  const btn  = el('btnLoginScreen');
  const desc = el('loginScreen')?.querySelector('.login-screen__desc');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> Ingresar con Google`;
  }
  if (desc) desc.textContent = 'Inicia sesión para acceder al directorio de la congregación.';
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
  // Mostrar pantalla de login por defecto hasta verificar sesión
  mostrarLoginScreen();

  // Manejar resultado de redirect (móviles) al cargar la página
  getRedirectResult(auth).then(result => {
    if (result) {
      console.log('[Auth] Login por redirect exitoso:', result.user.email);
      // onAuthStateChanged se encargará de verificar permisos
    }
  }).catch(err => {
    console.error('[Auth] Error en redirect result:', err);
    restaurarBotonLogin();
    const errEl = el('loginScreenError');
    mostrarErrorLogin(err, errEl);
  });

  onAuthStateChanged(auth, async usuario => {
    if (usuario) {
      // Mostrar spinner mientras se verifican permisos
      mostrarSpinnerLogin('Verificando acceso...');

      let acceso, rol;
      try {
        ({ acceso, rol } = await verificarAcceso(usuario.email));
      } catch (err) {
        // Error de red u otro inesperado — restaurar UI y mostrar mensaje
        console.error('[Auth] Error verificando acceso:', err);
        ocultarSpinnerLogin();
        restaurarBotonLogin();
        const errEl = el('loginScreenError');
        if (errEl) {
          errEl.textContent   = '📡 Error de conexión. Verifica tu internet e intenta de nuevo.';
          errEl.style.display = 'block';
        }
        mostrarLoginScreen();
        return;
      }

      ocultarSpinnerLogin();

      if (!acceso) {
        // Sin permiso: cerrar sesión automáticamente para no dejar al usuario
        // en un estado autenticado-pero-bloqueado, y mostrar pantalla denegado.
        await signOut(auth).catch(() => {});
        mostrarPantallaAccesoDenegado(usuario.email);
        return;
      }

      // Tiene acceso → cargar app
      ocultarPantallaAccesoDenegado();
      ocultarLoginScreen();

      const admin = rol === 'admin';
      rolActual = rol; // T5: actualizar estado global de rol
      el('btnLogin').style.display  = 'none';
      el('userBadge').style.display = '';
      el('userName').textContent    = usuario.displayName || usuario.email;
      el('userAvatar').src          = usuario.photoURL || '';
      aplicarRol(admin);
      registrarAcceso(usuario, admin);

      // Cargar datos solo cuando el usuario está autorizado
      await cargarApp();

    } else {
      ocultarSpinnerLogin();
      restaurarBotonLogin();
      mostrarLoginScreen();
      el('btnLogin').style.display  = '';
      el('userBadge').style.display = 'none';
      rolActual = null; // T5: limpiar rol al cerrar sesión
      aplicarRol(false);
    }
  });

  el('btnLogin').addEventListener('click', iniciarSesionConDeteccionMovil);

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
    // T5: intentarFirestore captura permission-denied sin crashear
    const snap = await intentarFirestore(
      conTimeout(getDocs(collection(db, COL)), 8000),
      'leer directorio'
    );

    // null = permission-denied (no debería ocurrir si verificarAcceso pasó, pero defensivo)
    if (snap === null) {
      toast('🔒 Sin permiso para leer el directorio. Contacta a un administrador.');
      personas = [];
      return;
    }

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
// T4: el ID del documento DEBE ser el email normalizado (minúsculas).
// Esto es requerido por las Security Rules: exists(/miembros/{email})
// solo funciona si el ID coincide exactamente con request.auth.token.email.
// Nunca usar addDoc ni doc(collection(db, COL)) que genera auto-IDs.
async function subirLoteAFirestore(lista) {
  const CHUNK = 400; // Firestore admite máximo 500 ops por batch
  for (let i = 0; i < lista.length; i += CHUNK) {
    const batch = writeBatch(db);
    lista.slice(i, i + CHUNK).forEach(p => {
      // ID = email normalizado. Si no tiene correo, usar un fallback legible
      const emailId = (p.correo || '').toLowerCase().trim()
                   || `sin-correo-${p.nombre || 'desconocido'}-${i}`.toLowerCase().replace(/\s+/g, '-');
      const ref   = doc(db, COL, emailId);
      const datos = limpiarParaFirestore(p);
      batch.set(ref, datos, { merge: true }); // merge evita sobrescribir si ya existe
      p.id = emailId; // guardar el id para referencias locales
    });
    await batch.commit();
  }
}

// ─── Firestore: guardar un miembro ───────────────────────────
// T4: el ID siempre es el email normalizado.
// Si la persona no tiene correo se usa su id previo o un slug del nombre.
async function guardarEnFirestore(persona) {
  const datos = limpiarParaFirestore(persona);
  // Determinar ID: prioridad → correo normalizado → id existente → slug nombre
  const emailId = (persona.correo || '').toLowerCase().trim()
               || persona.id
               || `sin-correo-${(persona.nombre || 'desconocido').toLowerCase().replace(/\s+/g, '-')}`;
  persona.id = emailId; // actualizar referencia local
  await setDoc(doc(db, COL, emailId), datos, { merge: true });
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
  // Usar fecha local del usuario (no UTC) para evitar desfasajes de zona horaria
  const hoy  = new Date();
  const dHoy = hoy.getDate();
  const mHoy = hoy.getMonth() + 1; // getMonth() devuelve 0-11, sumamos 1 para obtener 1-12

  const contHoy    = lista.filter(p => p.dia === dHoy && p.mes === mHoy).length;
  const contMes    = lista.filter(p => p.mes === mHoy).length;
  const contProx7  = lista.filter(p => diasHasta(p) >= 0 && diasHasta(p) <= 7).length;

  const cnt = Array(13).fill(0);
  personas.forEach(p => { if (p.mes >= 1 && p.mes <= 12) cnt[p.mes]++; });
  const max    = Math.max(...cnt.slice(1));
  const idxMax = cnt.indexOf(max);

  setText('totalMiembros', lista.length);
  setText('hoy',           contHoy);
  setText('esteMes',       contMes);
  setText('proximos7',     contProx7);
  setText('proximos7Sub',  contProx7 === 1 ? 'cumpleaños próximo' : contProx7 > 1 ? 'cumpleaños próximos' : '');
  setText('mesMas',        max > 0 ? MESES[idxMax] : '—');
  setText('mesMasCnt',     max > 0 ? `${max} cumpleaños` : '');

  // ── Tarjeta dinámica: próximo cumpleaños ──────────────────────
  actualizarProximoCumple();
}

function actualizarProximoCumple() {
  if (!personas.length) return;

  const hoy  = new Date();
  const dHoy = hoy.getDate();
  const mHoy = hoy.getMonth() + 1;

  // Ordenar todos por días restantes (de menor a mayor)
  const ordenados = [...personas]
    .map(p => ({ ...p, dias: diasHasta(p) }))
    .sort((a, b) => a.dias - b.dias);

  // ¿Hay alguien que cumpla HOY?
  const cumpleHoy = ordenados.filter(p => p.dia === dHoy && p.mes === mHoy);

  const labelEl  = document.getElementById('proximoLabel');
  const nombreEl = document.getElementById('proximoNombre');
  const diasEl   = document.getElementById('proximoDias');

  if (cumpleHoy.length > 0) {
    const nombres = cumpleHoy.map(p => p.nombre.split(' ')[0]).join(' · ');
    labelEl.textContent  = '🎂 ¡Hoy es su día!';
    nombreEl.textContent = nombres;
    diasEl.textContent   = cumpleHoy.length > 1 ? `${cumpleHoy.length} personas · ¡Felicítalas hoy 💛!` : '¡Felicítala hoy 💛!';
    nombreEl.style.color = 'var(--rojo)';
  } else {
    // Caso 2: el próximo más cercano
    const proximo = ordenados[0];
    if (!proximo) return;

    const dias    = proximo.dias;
    const nombre  = proximo.nombre.split(' ').slice(0, 2).join(' '); // Nombre + primer apellido
    const fecha   = `${proximo.dia} ${MESES[proximo.mes]}`;

    labelEl.textContent  = 'Próximo cumpleaños';
    nombreEl.textContent = nombre;
    diasEl.textContent   = dias === 1 ? `Mañana · ${fecha}` : `En ${dias} días · ${fecha}`;
    nombreEl.style.color = '';
  }
}

function diasHasta(p) {
  // Usar fecha local para calcular días restantes correctamente
  const hoy  = new Date();
  hoy.setHours(0, 0, 0, 0); // Normalizar a medianoche para comparación exacta

  // Crear fecha de cumpleaños del año actual
  let bday = new Date(hoy.getFullYear(), p.mes - 1, p.dia);
  bday.setHours(0, 0, 0, 0);

  // Si el cumpleaños ya pasó este año, calcular para el año siguiente
  if (bday < hoy) {
    bday.setFullYear(hoy.getFullYear() + 1);
  }

  // Calcular diferencia en días
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
      ${p.direccion ? `<span>📍 ${p.direccion}</span>` : ''}
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
      <button class="btn-detalle" data-action="detalle" data-idx="${idx}" title="Ver detalles">👁</button>
      ${esAdmin ? `
        <button class="btn btn--sm btn--outline" data-action="editar"   data-idx="${idx}">✏️</button>
        <button class="btn btn--sm btn--danger"  data-action="eliminar" data-idx="${idx}">🗑</button>
      ` : ''}
    </td>
  `;

  tr.querySelector('[data-action="detalle"]').addEventListener('click', e => abrirDetalle(parseInt(e.currentTarget.dataset.idx, 10)));
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

// ─── Modal de detalles del contacto ──────────────────────────
function abrirDetalle(idx) {
  const p    = personas[idx];
  const dias = diasHasta(p);
  const fecha = p.anio
    ? `${p.dia} ${MESES[p.mes]} ${p.anio}`
    : `${p.dia} ${MESES[p.mes]}`;

  // Avatar con inicial
  const inicial = (p.nombre || '?')[0].toUpperCase();
  el('detalleAvatar').textContent  = inicial;

  // Campos
  el('detalleTitulo').textContent  = p.nombre;
  el('detalleNombre').textContent  = p.nombre;
  el('detalleFecha').textContent   = fecha;
  el('detalleTel').textContent     = p.telefono  || '—';
  el('detalleCorreo').textContent  = p.correo    || '—';
  el('detalleProf').textContent    = p.profesion || '—';
  el('detalleDir').textContent     = p.direccion || '—';

  // Ocultar filas sin datos
  el('detalleTelWrap').style.display    = p.telefono  ? '' : 'none';
  el('detalleCorreoWrap').style.display = p.correo    ? '' : 'none';
  el('detalleProfWrap').style.display   = p.profesion ? '' : 'none';
  el('detalleDirWrap').style.display    = p.direccion ? '' : 'none';

  // Contador de días
  const diasEl = el('detalleDias');
  if (dias === 0) {
    diasEl.textContent  = '🎉 ¡Hoy cumple años!';
    diasEl.className    = 'detalle-dias detalle-dias--hoy';
  } else if (dias === 1) {
    diasEl.textContent  = '🎂 ¡Mañana cumple años!';
    diasEl.className    = 'detalle-dias detalle-dias--pronto';
  } else if (dias <= 7) {
    diasEl.textContent  = `🎂 Cumple en ${dias} días`;
    diasEl.className    = 'detalle-dias detalle-dias--pronto';
  } else {
    diasEl.textContent  = `📅 Cumple en ${dias} días`;
    diasEl.className    = 'detalle-dias';
  }

  el('modalDetalle').style.display = 'flex';
  setTimeout(() => el('modalDetalle').classList.add('modal--visible'), 10);
}

function cerrarDetalle() {
  el('modalDetalle').classList.remove('modal--visible');
  setTimeout(() => { el('modalDetalle').style.display = 'none'; }, 200);
}

// ─── T8: Upsert de perfil propio tras login exitoso ──────────
// setDoc + merge: crea el doc si no existe, actualiza si ya existe.
// ID = uid de Firebase Auth (no email), según US-006.
async function registrarAcceso(usuario, esAdmin) {
  try {
    await setDoc(doc(db, 'usuarios', usuario.uid), {
      email:        (usuario.email || '').toLowerCase().trim(),
      nombre:       usuario.displayName || '',
      foto:         usuario.photoURL    || '',
      esAdmin:      esAdmin,
      rol:          rolActual,          // 'admin' | 'lector' | 'miembro' | null
      ultimoAcceso: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    // permission-denied no debe crashear la app — solo log
    console.warn('[registrarAcceso] No se pudo guardar perfil:', err.code || err.message);
  }
}

// ─── Gestión de usuarios (panel admin) ────────────────────────
async function cargarListaUsuarios() {
  const lista = el('usuariosList');
  lista.innerHTML = '<div class="admins-list__loading">⏳ Cargando usuarios...</div>';

  try {
    const [snapUsuarios, snapAdmins] = await Promise.all([
      getDocs(collection(db, 'usuarios')),
      getDocs(collection(db, 'admin'))
    ]);

    const adminsSet = new Set(snapAdmins.docs.map(d => d.id));
    const usuarios  = snapUsuarios.docs.map(d => ({ uid: d.id, ...d.data() }));

    if (usuarios.length === 0) {
      lista.innerHTML = '<div class="admins-list__loading">No hay usuarios registrados aún.</div>';
      return;
    }

    // Admins primero, luego por último acceso
    usuarios.sort((a, b) => {
      if (adminsSet.has(a.email) !== adminsSet.has(b.email))
        return adminsSet.has(a.email) ? -1 : 1;
      return (b.ultimoAcceso || '').localeCompare(a.ultimoAcceso || '');
    });

    const emailActual = auth.currentUser?.email;

    lista.innerHTML = usuarios.map(u => {
      const esAdminU = adminsSet.has(u.email);
      const esTu     = u.email === emailActual;
      const inicial  = (u.nombre || u.email || '?')[0].toUpperCase();
      const fecha    = u.ultimoAcceso
        ? new Date(u.ultimoAcceso).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      return `
        <div class="usuario-item ${esAdminU ? 'usuario-item--admin' : ''}">
          <div class="usuario-item__avatar">
            ${u.foto ? `<img src="${u.foto}" alt="${u.nombre}">` : `<span>${inicial}</span>`}
          </div>
          <div class="usuario-item__info">
            <span class="usuario-item__nombre">${u.nombre || u.email}</span>
            <span class="usuario-item__email">${u.email}</span>
            <span class="usuario-item__fecha">🕐 ${fecha}</span>
          </div>
          <div class="usuario-item__acciones">
            ${esAdminU ? '<span class="usuario-item__badge--admin">Admin</span>' : ''}
            ${esTu
              ? '<span class="usuario-item__badge--tu">Tú</span>'
              : `<button class="btn btn--sm ${esAdminU ? 'btn--danger' : 'btn--outline'}"
                  data-action="${esAdminU ? 'degradar' : 'promover'}"
                  data-email="${u.email}">
                  ${esAdminU ? '⬇ Quitar' : '⬆ Admin'}
                </button>`}
          </div>
        </div>`;
    }).join('');

    lista.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { action, email } = btn.dataset;
        btn.disabled = true; btn.textContent = '⏳';
        if (action === 'promover') {
          await setDoc(doc(db, 'admin', email), { rol: 'admin' });
          toast(`✅ ${email} ahora es administrador.`);
        } else {
          await deleteDoc(doc(db, 'admin', email));
          toast(`🗑 ${email} ya no es administrador.`);
        }
        await cargarListaUsuarios();
      });
    });

  } catch (err) {
    console.error('Error al cargar usuarios:', err);
    lista.innerHTML = '<div class="admins-list__loading" style="color:var(--peligro)">❌ Error al cargar usuarios.</div>';
  }
}

async function abrirModalAdmins() {
  el('modalAdmins').style.display = 'flex';
  setTimeout(() => el('modalAdmins').classList.add('modal--visible'), 10);
  el('nuevoAdminEmail').value = '';
  el('adminFormError').style.display = 'none';
  // Abrir en pestaña Usuarios por defecto
  cambiarTabAdmin('usuarios');
}

function cerrarModalAdmins() {
  el('modalAdmins').classList.remove('modal--visible');
  setTimeout(() => { el('modalAdmins').style.display = 'none'; }, 200);
}

async function cargarListaLectores() {
  const lista = el('lectoresList');
  lista.innerHTML = '<div class="admins-list__loading">⏳ Cargando lectores...</div>';
  try {
    const snap = await getDocs(collection(db, 'lectores'));
    if (snap.empty) {
      lista.innerHTML = '<div class="admins-list__loading">No hay lectores registrados.</div>';
      return;
    }
    const emailActual = auth.currentUser?.email;
    lista.innerHTML = snap.docs.map(d => `
      <div class="admin-item">
        <span class="admin-item__email">${d.id}</span>
        ${d.id === emailActual ? '<span class="admin-item__badge">TÚ</span>' : ''}
        ${d.id !== emailActual ? `<button class="admin-item__remove" data-email="${d.id}" title="Quitar lector">🗑</button>` : ''}
      </div>`).join('');
    lista.querySelectorAll('.admin-item__remove').forEach(btn => {
      btn.addEventListener('click', () => eliminarLector(btn.dataset.email));
    });
  } catch (err) {
    console.error('Error al cargar lectores:', err);
    const msg = err?.code === 'permission-denied'
      ? '🔒 Solo los administradores pueden ver esta lista.'
      : '❌ Error al cargar lectores.';
    lista.innerHTML = `<div class="admins-list__loading" style="color:var(--peligro)">${msg}</div>`;
  }
}

async function agregarLector() {
  const email   = el('nuevoLectorEmail').value.trim().toLowerCase();
  const errorEl = el('lectorFormError');
  if (!email) { errorEl.textContent = 'Ingresa un correo.'; errorEl.style.display = 'block'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Correo inválido.'; errorEl.style.display = 'block'; return; }
  errorEl.style.display = 'none';
  el('btnAgregarLector').disabled = true;
  el('btnAgregarLector').textContent = '⏳';
  try {
    const existe = await getDoc(doc(db, 'lectores', email));
    if (existe.exists()) { errorEl.textContent = 'Este correo ya es lector.'; errorEl.style.display = 'block'; return; }
    await setDoc(doc(db, 'lectores', email), { rol: 'lector', creadoEn: new Date().toISOString() });
    toast(`✅ ${email} agregado como lector.`);
    el('nuevoLectorEmail').value = '';
    await cargarListaLectores();
  } catch (err) {
    errorEl.textContent = 'Error al agregar. Intenta de nuevo.'; errorEl.style.display = 'block';
  } finally {
    el('btnAgregarLector').disabled = false;
    el('btnAgregarLector').textContent = '+ Agregar';
  }
}

async function eliminarLector(email) {
  if (!confirm(`¿Quitar acceso de lectura a ${email}?`)) return;
  try {
    await deleteDoc(doc(db, 'lectores', email));
    toast(`🗑 ${email} eliminado de lectores.`);
    await cargarListaLectores();
  } catch (err) {
    toast('❌ Error al eliminar. Intenta de nuevo.');
  }
}

function cambiarTabAdmin(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.classList.toggle('admin-tab--active', t.dataset.tab === tab);
  });
  el('panelUsuarios').style.display = tab === 'usuarios' ? '' : 'none';
  el('panelAdmins').style.display   = tab === 'admins'   ? '' : 'none';
  el('panelLectores').style.display = tab === 'lectores' ? '' : 'none';
  if (tab === 'usuarios') cargarListaUsuarios();
  if (tab === 'admins')   cargarListaAdmins();
  if (tab === 'lectores') cargarListaLectores();
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
    const msg = err?.code === 'permission-denied'
      ? '🔒 Solo los administradores pueden ver esta lista.'
      : '❌ Error al cargar administradores.';
    lista.innerHTML = `<div class="admins-list__loading" style="color:var(--peligro)">${msg}</div>`;
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

  // Tarjeta próximo cumpleaños → filtra próximos 7 días
  el('card-proximo-cumple').addEventListener('click', () => {
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

  // Detalle contacto
  el('btnCerrarDetalle').addEventListener('click',    cerrarDetalle);
  el('modalDetalleClose').addEventListener('click',   cerrarDetalle);
  el('modalDetalleBackdrop').addEventListener('click',cerrarDetalle);
  el('modalDetalle').addEventListener('keydown', e => { if (e.key === 'Escape') cerrarDetalle(); });

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
  // Tabs del modal de admins
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => cambiarTabAdmin(tab.dataset.tab));
  });
  el('btnAgregarLector').addEventListener('click', agregarLector);
  el('nuevoLectorEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') agregarLector();
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
// Exponer toast globalmente para que el script del SW pueda usarla
window.toast = toast;

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
