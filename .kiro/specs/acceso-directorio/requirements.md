# Requirements – acceso-directorio

## Contexto

El directorio de la Iglesia Cristiana Aposento Alto – Piedra Viva es una PWA que muestra nombres,
fechas de cumpleaños y datos de contacto de los miembros de la congregación.
El acceso debe estar protegido: solo personas autorizadas pueden ver o modificar esos datos.

---

## Reglas de negocio (fuente de verdad)

| # | Sujeto | Condición | Resultado |
|---|--------|-----------|-----------|
| RB-1 | Usuario no autenticado | Cualquier intento de acceso | Sin acceso al directorio |
| RB-2 | Usuario autenticado | Email **no** está en `miembros` ni en `lectores` | Sin acceso al directorio |
| RB-3 | Usuario autenticado | Email **no** está en `miembros` pero **sí** está en `lectores` | Acceso de lectura |
| RB-4 | Usuario autenticado | Email **sí** está en `miembros` | Acceso de lectura |
| RB-5 | Usuario autenticado con rol admin | Promovido por otro admin existente | Acceso de escritura completo |
| RB-6 | Cualquier usuario | Intento de auto-promoción a admin desde el cliente | Denegado por las reglas de Firestore |

---

## Requisitos funcionales (notación EARS)

### RF-01 · Bloqueo sin sesión
**WHEN** un usuario no autenticado intenta acceder a cualquier documento de `miembros`,
**THE SYSTEM SHALL** denegar la solicitud con código de permiso denegado antes de retornar datos.

### RF-02 · Bloqueo por email no registrado
**WHEN** un usuario autenticado realiza una lectura sobre `miembros`
**AND** su email no existe como ID de documento en `miembros` ni en `lectores`,
**THE SYSTEM SHALL** denegar la solicitud sin exponer datos del directorio.

### RF-03 · Acceso por grant de lectura explícito
**WHEN** un usuario autenticado realiza una lectura sobre `miembros`
**AND** su email existe como ID de documento en `lectores`,
**THE SYSTEM SHALL** permitir la lectura de todos los documentos de `miembros`.

### RF-04 · Acceso por membresía en el directorio
**WHEN** un usuario autenticado realiza una lectura sobre `miembros`
**AND** su email existe como ID de documento en `miembros`,
**THE SYSTEM SHALL** permitir la lectura de todos los documentos de `miembros`.

### RF-05 · Escritura reservada para admins
**WHEN** cualquier usuario autenticado intenta crear, modificar o eliminar un documento en `miembros`,
**AND** su email no existe como ID de documento en `admind`,
**THE SYSTEM SHALL** denegar la operación de escritura.

### RF-06 · Gestión de lectores por admin
**WHEN** un usuario con rol admin crea o elimina un documento en `lectores`,
**THE SYSTEM SHALL** permitir la operación.

**WHEN** un usuario sin rol admin intenta crear o eliminar un documento en `lectores`,
**THE SYSTEM SHALL** denegar la operación.

### RF-07 · Promoción a admin solo por admin existente
**WHEN** un usuario con rol admin crea un documento en `admind` con el email de otro usuario,
**THE SYSTEM SHALL** permitir la operación.

**WHEN** cualquier usuario intenta crear un documento en `admind` para sí mismo
**OR** cuando un usuario sin rol admin intenta crear cualquier documento en `admind`,
**THE SYSTEM SHALL** denegar la operación.

### RF-08 · Perfil propio
**WHEN** un usuario autenticado lee o escribe el documento `usuarios/{uid}` cuyo ID coincide con su propio UID,
**THE SYSTEM SHALL** permitir la operación.

**WHEN** un usuario autenticado intenta leer `usuarios/{uid}` de otro usuario
**AND** no tiene rol admin,
**THE SYSTEM SHALL** denegar la operación.

### RF-09 · Primer admin (bootstrap)
**WHEN** no existe ningún documento en `admind`,
**THE SYSTEM SHALL** requerir que un operador humano cree manualmente el primer documento desde Firebase Console,
sin que ningún flujo del cliente pueda crear ese primer documento.

---

## Requisitos no funcionales

### RNF-01 · Autorización en el servidor
La lógica de autorización **MUST** residir en `firestore.rules`.
La UI puede mostrar/ocultar elementos por experiencia de usuario,
pero no es la línea de defensa principal.

### RNF-02 · Latencia de verificación
**WHEN** el usuario inicia sesión,
**THE SYSTEM SHALL** completar la verificación de acceso en menos de 3 segundos
en condiciones de red 4G estándar.

### RNF-03 · Sin exposición de datos en acceso denegado
**THE SYSTEM SHALL NOT** retornar ningún campo de ningún documento de `miembros`
a un usuario que no cumpla RF-03 o RF-04.

### RNF-04 · Compatibilidad móvil
**THE SYSTEM SHALL** usar `signInWithRedirect` en dispositivos móviles
para evitar el bloqueo de popups en navegadores de Android e iOS.

---

## Modelo de datos (resumen)

```
miembros/{email}     – directorio. ID = email del miembro (minúsculas).
lectores/{email}     – grant explícito de lectura. Gestionado por admin.
admind/{email}       – grant de escritura. Primer doc creado a mano en Console.
usuarios/{uid}       – perfil propio del usuario autenticado (uid Firebase Auth).
```

> **Decisión de diseño:** el ID del documento es el email (no el UID) en `miembros`,
> `lectores` y `admind` porque permite verificaciones con `exists()` en las Security Rules
> usando `request.auth.token.email`, sin necesidad de queries secundarias que consumen
> lecturas adicionales y complican las reglas.
