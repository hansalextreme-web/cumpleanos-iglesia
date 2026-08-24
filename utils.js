// utils.js – helper utilities for the birthday app

// ---------- Theme handling ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌙 Light' : '☀️ Dark';
}

function initTheme() {
  const saved = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- Search handling ----------
function initSearch() {
  const input = document.getElementById('searchBox');
  if (!input) return;
  input.addEventListener('input', mostrarLista);
}

// Función para obtener datos
export async function cargarDatos() {
  try {
    const response = await fetch('/api/datos');
    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Detalle del error al consultar la API:', error);
    return null;
  }
}

// Función para enviar datos (POST)
export async function guardarDatos(datosFormulario) {
  try {
    const response = await fetch('/api/datos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(datosFormulario)
    });

    if (!response.ok) {
      throw new Error(`Error HTTP: ${response.status}`);
    }

    const resultado = await response.json();
    console.log('Respuesta del servidor:', resultado);
    return resultado;
  } catch (error) {
    console.error('Error al guardar datos:', error);
  }
}

// The function mostrarLista will read the value of #searchBox and filter results accordingly.
// No additional code needed here; mostrarLista already references the input value.

// ---------- Reminder notifications (browser based) ----------
function scheduleReminder(person) {
  if (!('Notification' in window)) return; // Not supported
  // Ask permission once
  if (Notification.permission !== 'granted') {
    Notification.requestPermission();
    return;
  }
  const today = new Date();
  const bday = new Date(today.getFullYear(), person.mes - 1, person.dia);
  const diffDays = Math.round((bday - today) / (1000 * 60 * 60 * 24));
  // Notify 1 day before birthday (adjust as needed)
  if (diffDays === 1) {
    new Notification('🎂 Recordatorio', {
      body: `Mañana es el cumpleaños de ${person.nombre}`,
      icon: 'logo.png'
    });
  }
}

// Export as XLSX (optional enhancement)
function downloadXLSX() {
  if (!personas.length) return alert('No hay datos');
  const ws = XLSX.utils.json_to_sheet(personas.map(p => ({
    Nombre: p.nombre,
    Día: p.dia,
    Mes: nombresMeses[p.mes],
    Año: p.anio || ''
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cumpleaños');
  XLSX.writeFile(wb, 'Cumpleaños_Aposento_Alto.xlsx');
}
