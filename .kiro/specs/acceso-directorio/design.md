# Design – acceso-directorio

## 1. Arquitectura de autorización

```
┌─────────────────────────────────────────────────────────────┐
│  Cliente (PWA)                                              │
│                                                             │
│  ① Google Sign-In (redirect en móvil, popup en desktop)    │
│  ② verificarAcceso(email)  ──►  Firestore                   │
│      • getDoc admin/{email}     → rol admin                 │
│      • getDoc lectores/{email}  → rol lector                │
│      • getDoc miembros/{email}  → rol miembro               │
│  ③ Mostrar app | pantalla de acceso denegado                │
└──────────────────────────┬──────────────────────────────────┘
                           │ Todas las operaciones pasan por
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Cloud Firestore Security Rules  (línea de defensa real)    │
│                                                             │
│  esAdmin()     → exists admin/{email}                       │
│  esMiembro()   → exists miembros/{email}                    │
│  esLector()    → exists lectores/{email}                    │
│  tieneAcceso() → esAdmin() || esMiembro() || esLector()     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Por qué el email es el ID del documento

Las Security Rules de Firestore **no permiten queries** dentro de una regla; solo permiten
`exists()` y `get()` que operan sobre una ruta exacta.

Si el ID fuera un UID o un auto-ID opaco, verificar si el email del usuario está en `miembros`
requeriría traer **toda la colección** al cliente y filtrar en JavaScript — lo que haría
imposible proteger los datos en el servidor.

Al usar `email` como ID:
```js
// ✅ Verificación O(1) en las rules, sin query ni lectura adicional
exists(/databases/$(database)/documents/miembros/$(request.auth.token.email))
```

**Convenio:** el email se almacena siempre en minúsculas. El cliente normaliza con
`email.toLowerCase().trim()` antes de cualquier escritura o verificación.

---

## 3. Firestore Security Rules completas

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ─── Helpers ─────────────────────────────────────────────────
    // El ID del documento en admin, lectores y miembros ES el email
    // (minúsculas), igual que request.auth.token.email.
    // Esto permite verificaciones O(1) con exists() sin queries.

    function esAdmin() {
      return request.auth != null
          && request.auth.token.email != null
          && exists(/databases/$(database)/documents/admin/$(request.auth.token.email));
    }

    function esMiembro() {
      return request.auth != null
          && request.auth.token.email != null
          && exists(/databases/$(database)/documents/miembros/$(request.auth.token.email));
    }

    function esLector() {
      return request.auth != null
          && request.auth.token.email != null
          && exists(/databases/$(database)/documents/lectores/$(request.auth.token.email));
    }

    // Acceso de lectura al directorio: cualquiera de los tres roles
    function tieneAcceso() {
      return esAdmin() || esMiembro() || esLector();
    }

    // ─── miembros/{email} ────────────────────────────────────────
    match /miembros/{docId} {
      allow read:  if tieneAcceso();
      allow write: if esAdmin();
    }

    // ─── lectores/{email} ────────────────────────────────────────
    match /lectores/{email} {
      allow read:  if esAdmin()
                  || (request.auth != null
                      && request.auth.token.email == email);
      allow write: if esAdmin();
    }

    // ─── admin/{email} ───────────────────────────────────────────
    match /admin/{email} {
      allow read:  if esAdmin()
                  || (request.auth != null
                      && request.auth.token.email == email);
      allow write: if esAdmin();
    }

    // ─── usuarios/{uid} ──────────────────────────────────────────
    match /usuarios/{uid} {
      allow read:  if esAdmin()
                  || (request.auth != null && request.auth.uid == uid);
      allow write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

---

## 4. Rules Playground — guión de prueba manual

Usar en **Firebase Console → Firestore → Rules → Rules Playground**.

| # | Operación | Autenticado como | Resultado esperado |
|---|-----------|------------------|--------------------|
| P-01 | `get /miembros/cualquier-doc` | sin auth | ❌ DENEGADO |
| P-02 | `get /miembros/cualquier-doc` | user@externo.com (no en ninguna colección) | ❌ DENEGADO |
| P-03 | `get /miembros/cualquier-doc` | lector@iglesia.com (en `lectores`) | ✅ PERMITIDO |
| P-04 | `get /miembros/miembro@iglesia.com` | miembro@iglesia.com (en `miembros`) | ✅ PERMITIDO |
| P-05 | `create /miembros/nuevo@iglesia.com` | lector@iglesia.com | ❌ DENEGADO |
| P-06 | `create /miembros/nuevo@iglesia.com` | admin@iglesia.com (en `admin`) | ✅ PERMITIDO |
| P-07 | `create /admin/nuevo@iglesia.com` | lector@iglesia.com | ❌ DENEGADO (auto-promoción) |
| P-08 | `create /admin/nuevo@iglesia.com` | admin@iglesia.com | ✅ PERMITIDO |
| P-09 | `get /admin/admin@iglesia.com` | admin@iglesia.com | ✅ PERMITIDO (propio doc) |
| P-10 | `get /usuarios/uid-ajeno` | user@ejemplo.com (no admin) | ❌ DENEGADO |
| P-11 | `write /usuarios/uid-propio` | user@ejemplo.com (su propio uid) | ✅ PERMITIDO |

### Cómo ejecutar cada prueba en el Playground

1. Abrir Firebase Console → Firestore Database → Rules → **Rules Playground**
2. Seleccionar **Operación** (get / create / update / delete)
3. Escribir la **Ruta** del documento
4. En **Autenticación**: activar "Authentication" y completar `uid` y `email`
5. Hacer clic en **Run** y verificar el resultado

---

## 5. Bootstrap del primer admin

Las rules impiden que cualquier cliente cree el primer documento en `admin`
porque `esAdmin()` devuelve `false` cuando la colección está vacía.
El primer admin **debe crearse manualmente** desde Firebase Console:

### Pasos en Firebase Console

1. Ir a **Firebase Console → Firestore Database → Datos**
2. Hacer clic en **"+ Iniciar colección"**
3. ID de la colección: `admin`
4. ID del documento: `tu-email@gmail.com` (exactamente en minúsculas)
5. Agregar campo:
   - Campo: `activo`  |  Tipo: `boolean`  |  Valor: `true`
6. Hacer clic en **Guardar**

A partir de ese momento ese usuario puede promover a otros desde la UI
(panel Gestionar usuarios → pestaña Administradores).

> **Por qué nadie puede auto-promoverse:** la regla `allow write: if esAdmin()` sobre
> la colección `admin` requiere que el escritor ya sea admin. Si no hay ningún admin,
> la condición siempre es `false` para cualquier cliente.

---

## 6. Helpers de cliente (`index.js`)

### `clienteEsAdmin() → boolean`
Devuelve el estado en memoria sin llamar a Firestore.
```js
function clienteEsAdmin() { return esAdmin; }
```

### `puedeLeerDirectorio() → boolean`
Para guards de UI — no es la línea de defensa, solo para mostrar/ocultar elementos.
```js
function puedeLeerDirectorio() {
  return esAdmin || rolActual === 'lector' || rolActual === 'miembro';
}
```

### `verificarAcceso(email) → { acceso: boolean, rol: string }`
3 `getDoc` en paralelo, O(1) cada uno. `permission-denied` no crashea: se captura y
el usuario ve la pantalla de acceso denegado en lugar de un error sin manejar.

```js
async function verificarAcceso(email) {
  const emailNorm = email.toLowerCase().trim();
  const [adminSnap, lectorSnap, miembroSnap] = await Promise.all([
    getDoc(doc(db, 'admin',    emailNorm)),
    getDoc(doc(db, 'lectores', emailNorm)),
    getDoc(doc(db, 'miembros', emailNorm))
  ]);
  if (adminSnap.exists())   return { acceso: true, rol: 'admin'   };
  if (lectorSnap.exists())  return { acceso: true, rol: 'lector'  };
  if (miembroSnap.exists()) return { acceso: true, rol: 'miembro' };
  return { acceso: false, rol: null };
}
```

---

## 7. Flujo de autenticación completo

```
Usuario hace clic en "Ingresar con Google"
        │
        ├─ esMobile() ──► signInWithRedirect  (móvil)
        └─ !esMobile() ──► signInWithPopup    (desktop)
                │
        onAuthStateChanged dispara con usuario
                │
        verificarAcceso(email)
           catch(permission-denied) → mostrarPantallaAccesoDenegado
                │
        ┌───────┴────────┐
     acceso:false     acceso:true
        │                │
        ▼                ├─ aplicarRol(admin)
  Pantalla              ├─ registrarAcceso → upsert usuarios/{uid}
  "Acceso               └─ cargarApp()
  restringido"
```

---

## 8. Miembros: setDoc con ID = email, nunca addDoc

```js
// ✅ Correcto — ID determinístico = email normalizado
await setDoc(doc(db, 'miembros', email.toLowerCase().trim()), datos);

// ❌ Incorrecto — genera auto-ID aleatorio, rompe las rules
await addDoc(collection(db, 'miembros'), datos);
```

El auto-ID rompe las Security Rules porque `exists(/miembros/$(request.auth.token.email))`
no encontrará nunca el documento si su ID es un UUID opaco.

---

## 9. Índices de Firestore

Con el email como ID no se necesitan índices adicionales para verificación de acceso.
Si se agrega ordenación en el cliente (`orderBy`), Firestore pedirá crear un índice
compuesto — hacer clic en el enlace del error para crearlo automáticamente.
