# Backend para gimnasio

API REST con Node.js, Express, Sequelize y PostgreSQL. Gestiona socios, planes,
membresías y asistencias.

## Requisitos

- Node.js 20 o superior
- Docker Compose (para levantar PostgreSQL localmente) o una instancia PostgreSQL

## Inicio rápido

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env` y reemplaza `API_TOKEN` con un secreto
   aleatorio de al menos 32 bytes. Por ejemplo:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Genera también un secreto aleatorio independiente para `MEMBER_SESSION_SECRET`.
3. Define contraseñas únicas en `POSTGRES_PASSWORD` y `GYM_DB_PASSWORD`.
   `POSTGRES_PASSWORD` es para el usuario administrador de la base y `GYM_DB_PASSWORD`
   para el usuario limitado que usa la API. Pon la contraseña de `GYM_DB_PASSWORD`
   en `DATABASE_URL` (codificada para URL si contiene caracteres especiales).
4. Inicia la base de datos local:

   ```bash
   docker compose up -d db
   ```

5. Arranca el backend:

   ```bash
   npm run dev
   ```

En la primera inicialización, Docker crea un usuario administrador de PostgreSQL
y un usuario separado, sin privilegios de superusuario, para la API. El script
de inicialización solo se ejecuta cuando el volumen de PostgreSQL está vacío.
El usuario de la API solo puede operar dentro del esquema `gym`.
Al arrancar, Sequelize crea las tablas que todavía no existan. `sync()` no altera
tablas existentes; los cambios de esquema posteriores deben gestionarse con
migraciones antes de desplegar en producción.
En bases existentes, ejecuta las migraciones que falten antes de arrancar:
`migrations/20261014-add-member-dni-address.sql` añade DNI y domicilio
(obligatorios para nuevas altas; el DNI debe tener entre 7 y 8 dígitos y es
único) y `migrations/20261014-add-member-password-hash.sql` agrega un campo
opcional para hashes de contraseñas. Las migraciones conservan los registros
existentes; quienes no tienen contraseña todavía no pueden iniciar sesión desde
la app. `migrations/20261014-create-access-pass.sql` crea el almacenamiento de
los QR de acceso de un solo uso y
`migrations/20261014-create-workout-logs.sql` crea el historial de entrenamientos.
`migrations/20261014-create-community.sql` crea perfiles sociales optativos,
amistades, bloqueos, denuncias y mensajes privados.
`migrations/20261015-add-member-profile-photo.sql` añade almacenamiento opcional
para fotos JPEG de perfil. Se conservan optimizadas en PostgreSQL con un máximo
de 350 KB; el acceso a cada foto requiere sesión de socio y, para ver la foto de
otra persona, su perfil de Comunidad debe estar visible y ninguno debe haber
bloqueado al otro.
`migrations/20261015-create-pending-member-registrations.sql` crea el
almacenamiento temporal de solicitudes que aún deben confirmar el correo.
`migrations/20261015-create-member-push-tokens.sql` registra de forma privada
los tokens push de los dispositivos que autorizaron las notificaciones.

## Endpoints

Todas las rutas están bajo `/api`. Los errores se devuelven como JSON. Todas las
rutas excepto `GET /api/health`, `GET /api/public/plans`,
`POST /api/public/registrations`, `POST /api/public/registrations/verify`,
`POST /api/public/login`,
`POST /api/public/checkin-qr`, `GET /api/public/workouts`,
`POST /api/public/workouts`, `GET /api/public/billing`,
`GET/PUT /api/public/me`, `PUT /api/public/me/photo`,
`GET /api/public/members/:memberId/photo`, `/api/notifications/*` y las rutas `/api/community/*`
requieren el encabezado
`Authorization: Bearer <API_TOKEN>`. El servidor no inicia si el token no está
configurado o tiene menos de 32 bytes. No compartas el token ni lo guardes en el
código fuente. `GET /api/public/me` requiere en cambio la sesión Bearer del
`/public/me` (GET/PUT), `/public/me/photo` (PUT),
`/public/members/:memberId/photo` (GET), `/public/checkin-qr`,
`/public/attendance-insights`, `/public/workouts`, `/public/billing`, todas las rutas `/api/community/*` y `/api/notifications/*`
requieren sesión de socio; `/admin/access-qr/check-in` y las rutas de moderación
requieren sesión administrativa.
En producción, sirve la API únicamente mediante HTTPS o una red privada.

`GET /api/public/attendance-insights` resume los ingresos registrados en las
cuatro semanas completas anteriores, en franjas de dos horas y hora de Buenos
Aires. Devuelve solo recuentos agregados, sin datos de socios, y requiere sesión
de socio. No representa la ocupación actual ni incluye visitas sin check-in.

| Recurso | Rutas |
| --- | --- |
| Salud | `GET /api/health` |
| Socios | `GET /members`, `GET /members/:id`, `POST /members`, `PUT /members/:id`, `DELETE /members/:id` |
| Planes | `GET /plans`, `GET /plans/:id`, `POST /plans`, `PUT /plans/:id`, `DELETE /plans/:id` |
| Membresías | `GET /memberships`, `GET /memberships/:id`, `POST /memberships`, `PATCH /memberships/:id/status`, `DELETE /memberships/:id` |
| Asistencias | `GET /attendances?memberId=:id`, `POST /attendances`, `PATCH /attendances/:id/checkout` |
| Web pública | `GET /public/plans`, `POST /public/registrations/checkout`, `POST /public/registrations`, `POST /public/registrations/verify` |
| App de socios | `POST /public/login`, `GET/PUT /public/me`, `PUT /public/me/photo`, `GET /public/members/:memberId/photo`, `POST /public/checkin-qr`, `GET /public/attendance-insights`, `GET/POST /public/workouts`, `GET /public/billing` |
| Notificaciones de socios | `PUT/DELETE /notifications/push-token` (sesión de socio) |
| Comunidad | `GET/PUT /community/profile`, `GET /community/members`, `GET /community/requests`, `POST/DELETE /community/requests/:memberId`, `POST /community/requests/:memberId/accept`, `GET /community/friends`, `DELETE /community/friends/:memberId`, `GET /community/blocks`, `POST/DELETE /community/blocks/:memberId`, `POST /community/reports/:memberId`, `GET/POST /community/messages/:memberId` |
| Avisos | `POST /admin/notifications/promotional` (sesión administrativa) |
| Check-in administrativo | `POST /admin/access-qr/check-in` (sesión administrativa) |
| Moderación administrativa | `GET /admin/community/reports`, `PATCH /admin/community/reports/:id/status` (sesión administrativa) |

La comunidad solo está disponible para socios activos. Los perfiles se mantienen
ocultos hasta que cada socio habilita su visibilidad y completa su nivel y
objetivo. En búsquedas solo se comparte el nombre de pila, el nivel y el
objetivo; nunca se exponen correo, teléfono ni domicilio. Solo se puede iniciar
un chat cuando ambas personas aceptaron la amistad; bloquear corta el chat y
elimina la amistad. La foto de perfil solo se incluye cuando la persona decidió
mostrar su perfil y se entrega mediante una ruta autenticada; los datos de foto
no se incluyen en las respuestas JSON de socios. Las denuncias quedan guardadas para revisión en el panel
administrativo. Los mensajes se consultan cada cuatro segundos mientras el chat
está abierto. Un mensaje nuevo también genera una notificación push sin mostrar
el contenido del chat en la pantalla bloqueada. Los avisos promocionales se
envían desde el panel web solo a socios activos que hayan habilitado
notificaciones; el título y texto elegido por el gimnasio pueden aparecer en la
pantalla bloqueada. Expo acepta como máximo 100 notificaciones por petición y
los tokens que ya no están registrados se eliminan.

Las notificaciones usan Expo Push Service. Configura `EXPO_ACCESS_TOKEN` en
Gym back si habilitas la autenticación de la API de Expo (opcional), y aplica
la migración de tokens antes de arrancar el backend. En la app configura el
`projectId` de EAS y las credenciales push de APNs/FCM; el permiso se pide en
el teléfono al iniciar sesión. Las notificaciones remotas requieren una
compilación nativa de desarrollo o producción y un dispositivo físico; no se
prueban en Expo Go ni en la versión web. Expo confirma que aceptó cada envío,
pero esa aceptación no garantiza que el sistema operativo lo haya mostrado.

El registro desde la app envía los datos de inscripción a
`POST /api/public/registrations`; no envía ni almacena una contraseña en esta
etapa. Gym back conserva temporalmente los datos necesarios, envía un enlace
aleatorio de un solo uso y guarda únicamente el hash SHA-256 del token. El enlace
vence en 24 horas. La persona elige su contraseña en el sitio al confirmar el
correo; solo entonces se crea el socio y la solicitud pendiente. Las respuestas
no revelan si una dirección ya está registrada. Para iniciar sesión, la app
utiliza `POST /api/public/login`; `GET /api/public/me` valida la sesión. Las
sesiones duran siete días y los intentos de inicio de sesión están limitados.
Las rutas públicas de registro y checkout también limitan solicitudes por IP y
por dirección de correo (10 y 2 solicitudes por hora, respectivamente) para
reducir el abuso del envío de correos. Este contador reside en memoria: en un
despliegue con varias instancias debe sustituirse por un limitador compartido.
El nuevo campo `password_hash` es opcional para conservar los socios existentes;
quienes no tengan una contraseña configurada no podrán iniciar sesión hasta que
completen un flujo de alta con contraseña.

La app genera un QR de acceso con `POST /api/public/checkin-qr`; se requiere
una membresía vigente. Cada código vence en 60 segundos y la base de datos
guarda únicamente su hash. El personal lo valida en
`POST /api/admin/access-qr/check-in` con su sesión administrativa. La operación
consume el código y registra la asistencia en una transacción; un código no se
puede reutilizar.

El historial usa `GET /api/public/workouts` y `POST /api/public/workouts`,
protegidos por sesión de socio. Cada registro queda asociado a la cuenta
autenticada e incluye método, nivel, ejercicios con peso y repeticiones,
descripción y fecha. La API devuelve hasta los 20 registros más recientes.
Ejecuta `migrations/20261014-create-workout-logs.sql` en bases existentes
antes de desplegar esta función.

La app consulta `GET /api/public/billing` con la sesión del socio. Devuelve los
pagos de sus propias suscripciones clasificados por estado y las suscripciones
pendientes que todavía no tengan pagos registrados. La información es un
resumen de movimientos de Mercado Pago; no incluye un PDF ni reemplaza una
factura fiscal.

La web usa los endpoints públicos para mostrar planes activos y recibir
solicitudes de inscripción y comenzar el checkout recurrente. `POST
/api/public/registrations/checkout` crea un socio inactivo y una suscripción
pendiente, y devuelve un enlace hospedado por Mercado Pago. Tras crear el
checkout, la API envía al socio el correo de recepción de la solicitud usando
SMTP con el enlace individual de autorización de Mercado Pago. Si el correo no
se puede enviar, el checkout sigue disponible y la respuesta informa la
advertencia. El socio ingresa sus datos de pago en Mercado Pago; la aplicación
no recibe datos de tarjeta. No se crea una membresía ni se habilita el acceso
hasta que un webhook firmado confirma el pago aprobado.

Para previsualizar el correo localmente sin cobrar, configura
`MP_DEMO_MODE=true` y deja las credenciales de Mercado Pago vacías. El correo
incluye un enlace ficticio bajo `.invalid`; el endpoint no abre el checkout ni
guarda una inscripción de demostración. Este modo se ignora siempre cuando
`NODE_ENV=production`.

Las personas que ya enviaron una solicitud manual (`POST
/api/public/registrations`) pueden recibir su enlace desde **Solicitudes web**
en el panel. El administrador también puede confirmar una solicitud después de
verificar un pago externo. Configura `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y
`GYM_PUBLIC_URL`, y registra el endpoint de webhooks público HTTPS antes de
habilitar el pago en línea. El prorrateo con el checkout sin plan asociado debe
verificarse en sandbox antes de usar credenciales de producción.

### Recetas fitness

Los socios activos consultan las recetas publicadas con `GET /api/recipes`
(filtros opcionales `?tag=volumen|definicion|rapido|vegetariano` y
`?favorites=true`) y marcan favoritas con `PUT`/`DELETE
/api/recipes/:id/favorite`; todo requiere sesión de socio. El panel
administra las recetas con `GET|POST /api/admin/recipes` y
`PUT|DELETE /api/admin/recipes/:id`. Aplica antes
`migrations/20261015-create-recipes.sql`. La foto es opcional y debe ser una URL
HTTPS. Usa recetas propias o con licencia; los valores nutricionales son
orientativos.

### Recuperar contraseña

`POST /api/public/password-reset/request` (`{ email }`) responde siempre lo
mismo y, si la cuenta existe, envía un código de 6 dígitos por correo (vence en
15 minutos, máximo 5 intentos, límite por IP y por correo).
`POST /api/public/password-reset/confirm` (`{ email, code, password }`) cambia la
contraseña. Fuera de producción, si el correo termina en `.invalid` o no hay
SMTP, el código se imprime en la consola del backend. Las sesiones ya abiertas
no se cierran al cambiar la contraseña.

### Progreso

Con sesión de socio: `GET /api/progress` (medidas y marcas por ejercicio
calculadas desde los entrenamientos), `POST /api/progress/measurements` (una
medición por día; peso obligatorio) y `DELETE /api/progress/measurements/:id`.

### Clases

Con sesión de socio: `GET /api/classes` (próximos 14 días),
`POST|DELETE /api/classes/:id/book` (exige membresía vigente, cupo y que la clase
no haya empezado). El panel administra con `GET|POST /api/admin/classes`,
`PUT|DELETE /api/admin/classes/:id` y `POST /api/admin/classes/:id/cancel`
(avisa por push a quienes reservaron).

### Avisos automáticos

Cada 5 minutos, entre las 9 y las 20 h de Argentina, se envían por push: membresía
por vencer (3 y 1 días), recordatorio de volver a entrenar (5 días sin asistir,
una vez por semana) y clase en menos de una hora. `NotificationLog` evita
repeticiones. Desactívalo con `REMINDERS_ENABLED=false`.

### Chat en tiempo casi real

`GET /api/community/messages/:memberId?afterId=N&wait=20` mantiene la consulta
abierta hasta 25 s y responde apenas llega un mensaje nuevo.

Aplica `migrations/20261016-create-progress-classes-reminders.sql` (o deja que
`sequelize.sync()` cree las tablas al arrancar).

### Ejemplos

Crear un socio:

```json
{
  "firstName": "Ana",
  "lastName": "Pérez",
  "dni": "12345678",
  "address": "Calle 123, Ciudad, Provincia",
  "email": "ana@example.com",
  "phone": "+34 600 000 000"
}
```

Para llamar a una ruta protegida, envía el token:

```bash
curl http://localhost:3000/api/members \
  -H "Authorization: Bearer $API_TOKEN"
```

Crear un plan:

```json
{
  "name": "Mensual",
  "description": "Acceso general al gimnasio",
  "durationDays": 30,
  "price": 39.99
}
```

Crear una membresía; `startDate` es opcional y usa `YYYY-MM-DD`. La fecha de fin
se calcula a partir de la duración del plan:

```json
{
  "memberId": 1,
  "planId": 1
}
```

Registrar una asistencia requiere un socio activo y una membresía vigente:

```json
{
  "memberId": 1
}
```

## Variables de entorno

- `PORT`: puerto HTTP (por defecto `3000`)
- `NODE_ENV`: entorno de ejecución
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: credenciales de la única cuenta administradora. Usa una contraseña aleatoria de al menos 16 caracteres y guarda el archivo `.env` fuera del repositorio.
- `ADMIN_SESSION_SECRET`: secreto aleatorio de al menos 32 bytes para firmar sesiones del panel.
- `MEMBER_SESSION_SECRET`: secreto aleatorio independiente de al menos 32 bytes para firmar sesiones de socios.
- `API_TOKEN`: secreto Bearer para acceder a las rutas de la API
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: base de datos y credenciales administrativas usadas por Docker Compose
- `GYM_DB_USER`, `GYM_DB_PASSWORD`: usuario de base de datos de privilegios limitados usado por la API y creado en la inicialización
- `POSTGRES_PORT`: puerto local publicado para PostgreSQL (por defecto `5432`, solo accesible desde el equipo local)
- `DATABASE_URL`: URL de conexión PostgreSQL
- `CORS_ORIGIN`: orígenes permitidos separados por comas; si se omite, CORS queda desactivado
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: servidor SMTP, puerto, conexión TLS, credenciales y remitente usados para los correos de solicitudes públicas, incluidas las inscripciones web que inician el checkout. Usa `SMTP_SECURE=true` normalmente con el puerto 465 y `false` con 587.
- `MP_DEMO_MODE`: con valor `true`, permite probar el correo localmente con un enlace `.invalid` no funcional cuando las credenciales de Mercado Pago no están configuradas; no guarda registros y se desactiva automáticamente en producción.

Configura estas variables en el `.env` del backend antes de aceptar solicitudes.
Los errores de validación no devuelven los valores enviados por el cliente.
El limitador de correo es local al proceso; no lo consideres una cuota global
para SMTP si ejecutas varias instancias.
La interfaz administrativa y la API deben servirse en el mismo sitio (por
ejemplo, bajo el mismo dominio con un proxy HTTPS) para que la cookie `SameSite`
del panel funcione. Si tienen orígenes distintos pero son del mismo sitio,
incluye el origen exacto del frontend en `CORS_ORIGIN`. Las solicitudes que
cambian datos validan el encabezado `Origin` contra esa lista.
Los planes deben tener en su descripción todos los beneficios que quieres
informar en el correo de solicitud.

## Panel privado del gimnasio

El panel está disponible en `/admin` y usa las credenciales `ADMIN_EMAIL` y
`ADMIN_PASSWORD`. La sesión se firma en el backend y se guarda en una cookie
HttpOnly, SameSite Strict, con vencimiento de 8 horas. Las rutas administrativas
no aceptan el token de API desde el navegador y limitan los intentos de acceso.
Configura `CORS_ORIGIN` con el origen exacto del frontend.
En el entorno local, consulta esos dos valores en el `.env` del backend; nunca
compartas ni publiques ese archivo.

El panel muestra socios, membresías vigentes, altas, asistencias y una estimación
mensual basada en el precio y duración de las membresías activas. No representa
dinero efectivamente cobrado ni es un registro contable. Los pagos de
suscripciones automáticas sí conservan su estado y monto. Desde el panel se
pueden registrar socios con una membresía inicial, buscar y filtrar socios por
estado, asignar o renovar membresías y revisar las
vigencias que vencen en los próximos siete días. Al renovar, la fecha de inicio
sugerida es el día posterior al vencimiento actual; la API impide superponer
membresías activas. También se pueden activar/desactivar socios, cancelar
membresías y crear, editar o desactivar planes.

Estas operaciones usan rutas de `/api/admin` protegidas por la sesión del panel.
`POST /api/admin/members` crea al socio y su primera membresía en una transacción;
`POST /api/admin/members/:id/memberships` asigna o renueva un plan activo y acepta
`planId` y `startDate` (`YYYY-MM-DD`).
La sección **Registro de clientes** lista las solicitudes recibidas desde la web.
Después de comprobar el pago, el administrador puede confirmar el alta; la API
activa al socio y crea su membresía en una sola transacción.
Para un alta directa gestionada por el equipo, usa **Registrar cliente** en el
menú del panel; crea el socio y asigna su plan desde el flujo administrativo.

### Cobro mensual automático

Los planes de 30 días pueden usar cobro recurrente con Mercado Pago. Al inscribir
un socio, el administrador puede elegir el cobro manual existente o crear un
enlace seguro para que el socio autorice su medio de pago en el checkout alojado
por Mercado Pago. La aplicación no recopila ni almacena datos de tarjeta. El
socio debe aceptar la suscripción antes de que se active su acceso.
En un alta nueva desde el panel, después de ingresar los datos del socio el
administrador puede continuar al checkout hospedado por Mercado Pago para que
el pagador elija un medio de pago e ingrese allí los datos de su tarjeta.
El enlace de autorización también se conserva para compartir o reintentar el
flujo cuando corresponda.

La integración solicita a Mercado Pago el día de cobro 1 y el prorrateo
proporcional del primer período. La documentación consultada describe
`billing_day_proportional` para suscripciones con plan asociado; este proyecto
crea suscripciones sin plan asociado para usar el checkout alojado. Por eso,
debes confirmar en sandbox que Mercado Pago acepta esos parámetros en este flujo
y que el primer cobro coincide con el importe esperado antes de ofrecerlo a
clientes o habilitar credenciales de producción. Las pruebas automatizadas
verifican el payload enviado, pero no sustituyen esa prueba del proveedor.

Una vez verificado ese comportamiento, los pagos aprobados activan o renuevan
la membresía mediante webhooks firmados; pagos rechazados no conceden acceso y
un reembolso o contracargo notificado revoca el período correspondiente. El
panel permite cancelar los cargos futuros y mantiene vigente el período ya
pagado. Activa el cobro automático después del vencimiento de una membresía
pagada manualmente para evitar cargos duplicados. Mientras haya una suscripción
pendiente o activa, la API impide asignar otra membresía manual o desactivar al
socio sin cancelar primero los cargos automáticos.

Configura `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` en el `.env` del backend.
El panel indica si la integración está configurada. Mientras pruebes, utiliza
las credenciales de prueba de Mercado Pago; no uses credenciales de producción
hasta completar la validación del prorrateo y del ciclo de cobro. En la
configuración de webhooks de Mercado Pago registra
`https://TU_API/api/admin/webhooks/mercadopago` y habilita las notificaciones de
pagos y suscripciones. En producción esa URL debe ser pública y usar HTTPS; una
API que solo escucha en `localhost` no puede recibir confirmaciones del
proveedor. También configura `GYM_PUBLIC_URL` con el origen HTTPS del frontend.

El administrador debe compartir el enlace de autorización con el socio, por
ejemplo por WhatsApp. El importe final del prorrateo y el momento en que se
acreditan los fondos los determina Mercado Pago. Cambiar el precio de un plan
no altera suscripciones existentes.

Documentación del proveedor:
[suscripciones y prorrateo proporcional](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-associated-plan)
y [flujo de suscripción autorizado por el comprador](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/overview).
