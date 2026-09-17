# Tasks – acceso-directorio

## Convenciones

- Cada tarea tiene un ID único (`T-XX`).
- Las dependencias se indican con `Requiere:`.
- El estado inicial de todas las tareas es **pendiente**.
- Los tests con emulador corren con `firebase emulators:exec "node tests/rules.test.js"`.

---

## Bloque 1 – Firestore Security Rules

### T-01 · Escribir las Security Rules definitivas

**Archivo:** `firestore.rules`

**Qué hacer:**
Reemplazar el contenido actual con las rules del diseño (sección 3 de `design.md`).
Las rules deben definir exactamente cuatro helpers (`esAdmin`, `esMiembro`, `esLector`,
`tieneAcceso`) y cuatro bloques `match` (`miembros`, `lectores`, `admind`, `usuarios`).

**Criterio de aceptación:**
- [ ] Ningún helper definido queda sin invocar.
- [ ] `miembros` solo es legible por `tieneAcceso()`.
- [ ] `miembros` solo es escribible por `esAdmin()`.
- [ ] `lectores` solo es escribible por `esAdmin()`.
- [ ] `admind` solo es escribible por `esAdmin()` (cierra auto-promoción).
- [ ] `usuarios/{uid}` es escribible únicamente por el propio usuario.

**Archivo resultante:**
```
firestore.rules  ← reglas completas del diseño
```

---

### T-02 · Publicar las rules en Firebase Console

**Requiere:** T-01

**Qué hacer:**
1. Abrir Firebase Console → Firestore Database → Reglas.
2. Pegar el contenido de `firestore.rules`.
3. Hacer clic en **"Publicar"**.
4. Verificar que no aparezcan errores de sintaxis en la consola.

**Criterio de aceptación:**
- [ ] La consola muestra "Reglas publicadas correctamente" o equivalente.
- [ ] No hay puntos rojos de error en las líneas 10-11 (ni en ninguna otra).

---

## Bloque 2 – Primer admin (bootstrap)

### T-03 · Crear el primer documento en `admind` desde Firebase Console

**Requiere:** T-02

**Qué hacer:**
Seguir los pasos de la sección 4 de `design.md`:
1. Firestore → Datos → "+ Iniciar colección" → ID: `admind`
2. ID del documento: `<email-del-administrador>` (minúsculas)
3. Campo: `activo` / boolean / `true`
4. Guardar.

**Criterio de aceptación:**
- [ ] Existe el documento `admind/<email>` en Firestore.
- [ ] Al iniciar sesión con ese email en la app, el rol visible es "Administrador".
- [ ] El panel de gestión de usuarios muestra las pestañas Usuarios, Administradores y Lectores.

---

### T-04 · Verificar que la auto-promoción es imposible desde el cliente

**Requiere:** T-03

**Qué hacer:**
1. Iniciar sesión con un email que **no** esté en `admind`.
2. Abrir la consola del navegador e intentar:
   ```js
   import { getFirestore, doc, setDoc } from 'firebase/firestore';
   const db = getFirestore();
   await setDoc(doc(db, 'admind', 'mi-email@ejemplo.com'), { activo: true });
   ```
3. Firestore debe rechazar con `PERMISSION_DENIED`.

**Criterio de aceptación:**
- [ ] La escritura falla con error de permisos.
- [ ] El documento **no** aparece en Firestore.

---

## Bloque 3 – Helpers de cliente

### T-05 · Implementar `verificarAcceso(email)` en `index.js`

**Requiere:** T-01

**Qué hacer:**
Asegurarse de que la función `verificarAcceso` en `index.js` sigue exactamente el diseño
de la sección 5 de `design.md`:
- Normaliza el email con `.toLowerCase().trim()`.
- Ejecuta `Promise.all` para `admind` y `lectores` en paralelo.
- Si ninguno existe, hace query `where('correo', '==', emailNorm)` sobre `miembros`.
- Retorna `{ acceso: boolean, rol: 'admin' | 'lector' | 'miembro' | null }`.

**Criterio de aceptación:**
- [ ] Admin existente → `{ acceso: true, rol: 'admin' }`.
- [ ] Lector explícito → `{ acceso: true, rol: 'lector' }`.
- [ ] Email en miembros → `{ acceso: true, rol: 'miembro' }`.
- [ ] Email sin registro → `{ acceso: false, rol: null }`.

---

### T-06 · Implementar `esMobile()` e `iniciarSesionConDeteccionMovil()`

**Requiere:** T-05

**Qué hacer:**
Verificar que en `index.js`:
- `esMobile()` detecta User-Agent y ancho de pantalla.
- `iniciarSesionConDeteccionMovil()` usa `signInWithRedirect` en móvil y
  `signInWithPopup` en desktop.
- El bloque `catch` siempre llama `restaurarBotonLogin()` para que el botón
  nunca quede bloqueado en "⏳ Ingresando...".
- `getRedirectResult(auth)` se llama al inicio de `iniciarAuth()` para
  capturar el resultado del redirect en móvil.

**Criterio de aceptación:**
- [ ] En Chrome Android, el botón redirige a Google sin popup.
- [ ] Si el usuario cancela o hay error de red, el botón vuelve a "Ingresar con Google".
- [ ] En Chrome desktop, sigue abriendo popup.

---

### T-07 · Normalizar emails al escribir en Firestore

**Requiere:** T-05

**Qué hacer:**
En todas las funciones que escriben documentos en `miembros`, `lectores` o `admind`,
asegurar que el ID del documento y el campo `correo` se guarden siempre en minúsculas:
```js
const emailNorm = email.toLowerCase().trim();
await setDoc(doc(db, 'miembros', emailNorm), { correo: emailNorm, ... });
```

**Criterio de aceptación:**
- [ ] No existe ningún documento en esas colecciones con letras mayúsculas en el ID.
- [ ] La función `verificarAcceso` encuentra el documento independientemente de cómo
      el usuario escribió su email al registrarlo.

---

## Bloque 4 – UI

### T-08 · Pantalla de login con feedback de carga

**Requiere:** T-06

**Qué hacer:**
Verificar en `index.html` y `style.css`:
- El botón muestra "⏳ Ingresando..." al hacer clic y se deshabilita.
- Durante `verificarAcceso`, el botón muestra "⟳ Verificando acceso...".
- Si hay error, el botón vuelve al estado original con el ícono de Google.
- El `div#loginScreenError` muestra mensajes específicos en español para cada código
  de error de Firebase (`auth/popup-blocked`, `auth/network-request-failed`, etc.).

**Criterio de aceptación:**
- [ ] El botón nunca queda permanentemente deshabilitado.
- [ ] El mensaje de error desaparece al volver a intentar.

---

### T-09 · Pantalla de acceso denegado

**Requiere:** T-08

**Qué hacer:**
Verificar que `mostrarPantallaAccesoDenegado(email)` en `index.js`:
- Oculta `#loginScreen` y `#app`.
- Crea (si no existe) un `div#accesoDenegado` con el email del usuario y el botón
  "↩ Cerrar sesión".
- El botón "Cerrar sesión" llama a `signOut(auth)`.

**Criterio de aceptación:**
- [ ] Un usuario con email no registrado ve la pantalla "🔒 Acceso restringido"
      con su propio email visible.
- [ ] El botón "Cerrar sesión" funciona y vuelve a la pantalla de login.

---

### T-10 · Panel de gestión de usuarios (admin)

**Requiere:** T-09

**Qué hacer:**
Verificar que la UI de "Gestionar usuarios" (modal con pestañas) permite a un admin:
- **Pestaña Usuarios:** listar la colección `usuarios` con último acceso.
- **Pestaña Administradores:** listar `admind`, agregar y revocar admins por email.
- **Pestaña Lectores:** listar `lectores`, agregar y revocar lectores por email.

Todos los botones de agregar/revocar deben:
- Llamar a `setDoc` / `deleteDoc` en la colección correspondiente.
- Mostrar un toast de confirmación o error.

**Criterio de aceptación:**
- [ ] Un admin puede agregar un lector por email → el nuevo lector puede acceder.
- [ ] Un admin puede revocar un lector → el lector pierde acceso en el próximo login.
- [ ] Un admin puede promover a otro admin → el nuevo admin ve los controles de escritura.
- [ ] Un usuario sin rol admin no ve ni puede invocar estas funciones.

---

## Bloque 5 – Tests con emulador de Firestore

### T-11 · Configurar Firebase Emulator Suite

**Qué hacer:**
1. Instalar Firebase CLI si no está: `npm install -g firebase-tools`.
2. Ejecutar `firebase init emulators` y habilitar **Firestore** y **Auth**.
3. Crear el archivo `firebase.json` con la configuración de emuladores:
   ```json
   {
     "emulators": {
       "auth":      { "port": 9099 },
       "firestore": { "port": 8080 },
       "ui":        { "enabled": true }
     }
   }
   ```
4. Crear `tests/rules.test.js` con las pruebas de los bloques siguientes.

**Criterio de aceptación:**
- [ ] `firebase emulators:start` arranca sin errores.
- [ ] La UI del emulador es accesible en `http://localhost:4000`.

---

### T-12 · Tests de las Security Rules

**Requiere:** T-11, T-01

**Qué hacer:**
Escribir tests en `tests/rules.test.js` usando `@firebase/rules-unit-testing`:

```js
// Casos a cubrir:

// 1. Usuario no autenticado no puede leer miembros
// 2. Usuario autenticado cuyo email NO está en miembros/lectores/admind → DENEGADO
// 3. Usuario cuyo email SÍ está en lectores → puede leer miembros
// 4. Usuario cuyo email SÍ está en miembros → puede leer miembros
// 5. Usuario sin admin → NO puede escribir en miembros
// 6. Admin → puede escribir en miembros
// 7. Usuario sin admin → NO puede escribir en admind (auto-promoción denegada)
// 8. Admin → puede escribir en admind (promover a otro)
// 9. Usuario puede leer/escribir su propio usuarios/{uid}
// 10. Usuario NO puede leer usuarios/{uid} de otro usuario sin ser admin
```

**Criterio de aceptación:**
- [ ] Los 10 casos pasan con `firebase emulators:exec "node tests/rules.test.js"`.
- [ ] Ningún caso produce falso positivo (acceso donde no debería).
- [ ] Ningún caso produce falso negativo (bloqueo donde sí debería permitir).

---

## Orden de ejecución sugerido

```
T-01 → T-02 → T-03 → T-04
T-01 → T-05 → T-06 → T-07
           T-05 → T-08 → T-09 → T-10
T-11 → T-12
```

Los bloques 1-4 pueden avanzar en paralelo con el bloque 5 (emulador)
siempre que T-01 esté completo.
