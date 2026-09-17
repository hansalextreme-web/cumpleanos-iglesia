/**
 * tests/rules.test.js
 * ───────────────────────────────────────────────────────────────
 * Tests de Firestore Security Rules para el proyecto acceso-directorio.
 * Cubre los 6 User Stories del spec (US-001 … US-006).
 *
 * REQUISITOS PREVIOS:
 *   npm install           (instala @firebase/rules-unit-testing)
 *   firebase emulators:start --only firestore,auth
 *
 * EJECUCIÓN:
 *   npm run test:emulator
 *   — o —
 *   firebase emulators:exec --only firestore,auth "node tests/rules.test.js"
 */

'use strict';

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve }      = require('path');

// ─── Constantes de prueba ────────────────────────────────────
const PROJECT_ID  = 'cumpleanos-iglesia-test';
const RULES_PATH  = resolve(__dirname, '../firestore.rules');

// Emails fijos para los escenarios
const EMAIL_ADMIN   = 'admin@iglesia.com';
const EMAIL_LECTOR  = 'lector@iglesia.com';
const EMAIL_MIEMBRO = 'miembro@iglesia.com';
const EMAIL_EXTERNO = 'externo@afuera.com';
const UID_MIEMBRO   = 'uid-miembro-001';
const UID_EXTERNO   = 'uid-externo-002';
const UID_ADMIN     = 'uid-admin-003';

// ─── Setup global ────────────────────────────────────────────
let testEnv;

async function setup() {
  testEnv = await initializeTestEnvironment({
    projectId:  PROJECT_ID,
    firestore: {
      rules:    readFileSync(RULES_PATH, 'utf8'),
      host:     'localhost',
      port:     8080,
    },
  });

  // Seed: poblar colecciones de control con datos conocidos
  await testEnv.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    // admin
    await db.collection('admin').doc(EMAIL_ADMIN).set({ rol: 'admin', activo: true });
    // lectores
    await db.collection('lectores').doc(EMAIL_LECTOR).set({ rol: 'lector' });
    // miembros (ID = email, según T4 y el modelo del spec)
    await db.collection('miembros').doc(EMAIL_MIEMBRO).set({
      correo:   EMAIL_MIEMBRO,
      nombre:   'Miembro De Prueba',
      dia:      15,
      mes:      8,
    });
    // usuarios
    await db.collection('usuarios').doc(UID_MIEMBRO).set({
      email: EMAIL_MIEMBRO,
      nombre: 'Miembro De Prueba',
    });
    await db.collection('usuarios').doc(UID_ADMIN).set({
      email: EMAIL_ADMIN,
      nombre: 'Admin De Prueba',
    });
  });
}

async function teardown() {
  await testEnv.cleanup();
}

// ─── Helpers ─────────────────────────────────────────────────
/** Firestore de un usuario autenticado con email y uid dados. */
function dbAs(uid, email) {
  return testEnv.authenticatedContext(uid, { email }).firestore();
}

/** Firestore sin autenticar. */
function dbAnon() {
  return testEnv.unauthenticatedContext().firestore();
}

// ─── Mini runner sin dependencias externas ───────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function it(description, fn) {
  try {
    await fn();
    console.log(`  ✅ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${description}`);
    console.error(`     ${err.message || err}`);
    failed++;
    failures.push({ description, err });
  }
}

// ─── Suites ──────────────────────────────────────────────────

async function suite_US001_visitanteNoAutenticado() {
  console.log('\n📋 US-001: Visitante no autenticado no puede ver el directorio');

  await it('get /miembros/{doc} → DENEGADO', async () => {
    const db = dbAnon();
    await assertFails(db.collection('miembros').doc(EMAIL_MIEMBRO).get());
  });

  await it('list /miembros → DENEGADO', async () => {
    const db = dbAnon();
    await assertFails(db.collection('miembros').get());
  });

  await it('create /miembros/{doc} → DENEGADO', async () => {
    const db = dbAnon();
    await assertFails(
      db.collection('miembros').doc('nuevo@test.com').set({ nombre: 'X' })
    );
  });

  await it('write /admin/{doc} → DENEGADO', async () => {
    const db = dbAnon();
    await assertFails(
      db.collection('admin').doc('intruso@test.com').set({ rol: 'admin' })
    );
  });
}

async function suite_US002_autenticadoSinRegistro() {
  console.log('\n📋 US-002: Autenticado sin registro en ninguna colección → DENEGADO');

  await it('get /miembros → DENEGADO (no está en admin/lectores/miembros)', async () => {
    const db = dbAs(UID_EXTERNO, EMAIL_EXTERNO);
    await assertFails(db.collection('miembros').doc(EMAIL_MIEMBRO).get());
  });

  await it('list /miembros → DENEGADO', async () => {
    const db = dbAs(UID_EXTERNO, EMAIL_EXTERNO);
    await assertFails(db.collection('miembros').get());
  });
}

async function suite_US003_lectura() {
  console.log('\n📋 US-003: Acceso de lectura — lector, miembro y admin pueden leer');

  await it('lector lee /miembros → PERMITIDO (AC-1)', async () => {
    const db = dbAs('uid-lector', EMAIL_LECTOR);
    await assertSucceeds(db.collection('miembros').doc(EMAIL_MIEMBRO).get());
  });

  await it('miembro lee /miembros → PERMITIDO (AC-2)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertSucceeds(db.collection('miembros').doc(EMAIL_MIEMBRO).get());
  });

  await it('admin lee /miembros → PERMITIDO (AC-3)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(db.collection('miembros').doc(EMAIL_MIEMBRO).get());
  });

  await it('lector escribe /miembros → DENEGADO (AC-4)', async () => {
    const db = dbAs('uid-lector', EMAIL_LECTOR);
    await assertFails(
      db.collection('miembros').doc('nuevo@test.com').set({ nombre: 'X' })
    );
  });
}

async function suite_US004_escrituraAdmin() {
  console.log('\n📋 US-004: Admin puede escribir; auto-promoción denegada');

  await it('admin crea /miembros/{doc} → PERMITIDO (AC-2)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(
      db.collection('miembros').doc('nuevo@iglesia.com').set({
        correo: 'nuevo@iglesia.com', nombre: 'Nuevo', dia: 1, mes: 1,
      })
    );
  });

  await it('admin borra /miembros/{doc} → PERMITIDO', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(
      db.collection('miembros').doc('nuevo@iglesia.com').delete()
    );
  });

  await it('no-admin escribe /miembros → DENEGADO (AC-3)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertFails(
      db.collection('miembros').doc('otro@iglesia.com').set({ nombre: 'X' })
    );
  });

  await it('admin promueve a otro en /admin → PERMITIDO (AC-1)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(
      db.collection('admin').doc('nuevo-admin@iglesia.com').set({ rol: 'admin' })
    );
  });

  await it('auto-promoción /admin → DENEGADO (AC-4)', async () => {
    const db = dbAs(UID_EXTERNO, EMAIL_EXTERNO);
    await assertFails(
      db.collection('admin').doc(EMAIL_EXTERNO).set({ rol: 'admin' })
    );
  });

  await it('cada usuario lee su propio /admin/{email} → PERMITIDO (AC-5)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(db.collection('admin').doc(EMAIL_ADMIN).get());
  });

  await it('admin lista toda la colección /admin → PERMITIDO (AC-5)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(db.collection('admin').get());
  });

  await it('no-admin lee /admin/{email-ajeno} → DENEGADO', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertFails(db.collection('admin').doc(EMAIL_ADMIN).get());
  });
}

async function suite_US005_lectoresGestionados() {
  console.log('\n📋 US-005: Colección lectores administrada por admins');

  await it('admin agrega /lectores/{email} → PERMITIDO (AC-1)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(
      db.collection('lectores').doc('nuevo-lector@iglesia.com').set({ rol: 'lector' })
    );
  });

  await it('admin elimina /lectores/{email} → PERMITIDO (AC-1)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(
      db.collection('lectores').doc('nuevo-lector@iglesia.com').delete()
    );
  });

  await it('no-admin escribe /lectores → DENEGADO (AC-1)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertFails(
      db.collection('lectores').doc(EMAIL_MIEMBRO).set({ rol: 'lector' })
    );
  });

  await it('lector lee su propio /lectores/{email} → PERMITIDO (AC-2)', async () => {
    const db = dbAs('uid-lector', EMAIL_LECTOR);
    await assertSucceeds(db.collection('lectores').doc(EMAIL_LECTOR).get());
  });

  await it('lector lee /lectores/{email-ajeno} → DENEGADO (AC-2)', async () => {
    const db = dbAs('uid-lector', EMAIL_LECTOR);
    await assertFails(db.collection('lectores').doc(EMAIL_ADMIN).get());
  });
}

async function suite_US006_perfilPropio() {
  console.log('\n📋 US-006: Perfil de usuario propio en /usuarios/{uid}');

  await it('usuario escribe su propio /usuarios/{uid} → PERMITIDO (AC-1)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertSucceeds(
      db.collection('usuarios').doc(UID_MIEMBRO).set(
        { email: EMAIL_MIEMBRO, ultimoAcceso: new Date().toISOString() },
        { merge: true }
      )
    );
  });

  await it('usuario lee su propio /usuarios/{uid} → PERMITIDO (AC-2)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertSucceeds(db.collection('usuarios').doc(UID_MIEMBRO).get());
  });

  await it('usuario lee /usuarios/{uid-ajeno} → DENEGADO (AC-2)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertFails(db.collection('usuarios').doc(UID_EXTERNO).get());
  });

  await it('usuario escribe /usuarios/{uid-ajeno} → DENEGADO (AC-1)', async () => {
    const db = dbAs(UID_MIEMBRO, EMAIL_MIEMBRO);
    await assertFails(
      db.collection('usuarios').doc(UID_EXTERNO).set({ hack: true })
    );
  });

  await it('admin lee /usuarios/{uid-ajeno} → PERMITIDO (AC-2)', async () => {
    const db = dbAs(UID_ADMIN, EMAIL_ADMIN);
    await assertSucceeds(db.collection('usuarios').doc(UID_MIEMBRO).get());
  });
}

// ─── Entry point ─────────────────────────────────────────────
(async () => {
  console.log('🔥 Iniciando tests de Firestore Security Rules');
  console.log(`   Proyecto: ${PROJECT_ID}`);
  console.log(`   Rules:    ${RULES_PATH}`);
  console.log(`   Emulador: localhost:8080\n`);

  try {
    await setup();

    await suite_US001_visitanteNoAutenticado();
    await suite_US002_autenticadoSinRegistro();
    await suite_US003_lectura();
    await suite_US004_escrituraAdmin();
    await suite_US005_lectoresGestionados();
    await suite_US006_perfilPropio();

  } finally {
    await teardown();
  }

  // ─── Resumen ───────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n' + '─'.repeat(50));
  console.log(`Resultados: ${passed}/${total} tests pasaron`);

  if (failures.length > 0) {
    console.log('\nFallos:');
    failures.forEach(({ description, err }) => {
      console.log(`  ✗ ${description}`);
      console.log(`    ${err?.message || err}`);
    });
  }

  console.log('─'.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
})();
