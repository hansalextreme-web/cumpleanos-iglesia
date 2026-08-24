# Análisis del Proyecto — Directorio de Cumpleaños Iglesia Piedra Viva

## ¿Qué hace la aplicación?

Es una aplicación web para gestionar el directorio de cumpleaños de los miembros de la iglesia **Piedra Viva / Aposento Alto**. Permite a los líderes consultar los ~123 miembros del directorio, ver quién cumple años hoy o en los próximos días, buscar y filtrar por nombre/mes/fecha, agregar o editar registros, e importar/exportar datos desde Excel/CSV.

**Tecnologías:** HTML5 + CSS3 + JavaScript vanilla (sin frameworks), SheetJS para Excel, desplegado en Vercel con una función serverless básica. Los datos se guardan en `localStorage` del navegador.

---

## 10 Oportunidades de Mejora

### 1. Persistencia real en la nube
Actualmente los datos solo se guardan en `localStorage` del navegador. Si el usuario borra caché o accede desde otro dispositivo, pierde los cambios. Conectar la app a una base de datos real (Firebase Firestore, Supabase, o similar) garantizaría que los datos estén disponibles desde cualquier lugar y sean compartidos entre todos los líderes.

### 2. Sistema de notificaciones automáticas por WhatsApp o correo
La app tiene la estructura para saber quién cumple años cada día, pero no actúa sobre eso. Integrar un servicio como Twilio (WhatsApp/SMS) o Resend (email) permitiría enviar felicitaciones automáticas el día del cumpleaños, sin que nadie tenga que revisar la app a diario.

### 3. Autenticación y control de acceso por roles
No hay ningún sistema de login. Cualquiera con el link puede ver y editar todos los datos. Implementar autenticación (Google Auth, por ejemplo) con roles diferenciados (administrador / lector) protegería la información y permitiría auditar quién hace cambios.

### 4. Vista de calendario interactivo
Actualmente los miembros se muestran en tarjetas o tabla. Agregar una vista de calendario mensual donde cada día muestre visualmente quién cumple años facilitaría la planificación pastoral y haría la app más intuitiva para todos los líderes.

### 5. PWA (Progressive Web App) — instalable en el celular
Con una configuración mínima (`manifest.json` + service worker) la app podría instalarse como una app nativa en el celular de los líderes. Funcionaría sin conexión, enviaría notificaciones push y daría una experiencia mucho más profesional.

### 6. Panel de administración para actualizar el directorio sin tocar código
Actualmente para actualizar el directorio hay que editar el Excel y correr `node rebuild_data.js` manualmente. Un formulario de administración conectado a la base de datos en la nube permitiría agregar, editar o eliminar miembros directamente desde el navegador, sin necesidad de conocimientos técnicos.

### 7. Estadísticas y reportes visuales
El dashboard tiene 6 métricas básicas. Se podría ampliar con gráficas (Chart.js o similar) que muestren distribución de cumpleaños por mes, grupos de edad, porcentaje de miembros con datos completos, etc. Esto daría a los líderes una visión más rica del directorio.

### 8. Historial de felicitaciones y seguimiento pastoral
Agregar la posibilidad de registrar si ya se felicitó a un miembro (check de "felicitado"), agregar notas pastorales por persona, o marcar si el miembro está activo/inactivo. Esto convertiría la app de un simple directorio en una herramienta de seguimiento pastoral.

### 9. Unificación y limpieza del código base
El proyecto tiene dos versiones paralelas (`index.html` y `cumpleanos-iglesia.html`) con lógica duplicada, dos archivos CSS (`style.css` y `styles.css`), datos precargados tanto en `directorio.js` como hardcodeados en el HTML, y el toggle de tema implementado a medias. Consolidar todo eliminaría bugs potenciales y facilitaría el mantenimiento.

### 10. Versión multiidioma y adaptable a otras congregaciones
El directorio está pensado específicamente para Piedra Viva, pero la estructura es perfectamente reutilizable. Parametrizar el nombre de la iglesia, el logo y los colores (ya hay un sistema de variables CSS) permitiría ofrecer esta herramienta a otras congregaciones, o incluso convertirla en un pequeño producto SaaS.

---

*Análisis generado el 15 de agosto de 2026.*
