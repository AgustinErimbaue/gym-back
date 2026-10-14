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
Para añadir DNI y domicilio a una base existente, ejecuta
`migrations/20261014-add-member-dni-address.sql` antes de arrancar esta versión.
Los dos campos son obligatorios para nuevas altas; los registros históricos
pueden conservarlos vacíos. El DNI debe tener entre 7 y 8 dígitos y es único.

## Endpoints

Todas las rutas están bajo `/api`. Los errores se devuelven como JSON. Todas las
rutas excepto `GET /api/health`, `GET /api/public/plans` y
`POST /api/public/registrations` requieren el encabezado
`Authorization: Bearer <API_TOKEN>`. El servidor no inicia si el token no está
configurado o tiene menos de 32 bytes. No compartas el token ni lo guardes en el
código fuente. En producción, sirve la API únicamente mediante HTTPS o una red
privada.

| Recurso | Rutas |
| --- | --- |
| Salud | `GET /api/health` |
| Socios | `GET /members`, `GET /members/:id`, `POST /members`, `PUT /members/:id`, `DELETE /members/:id` |
| Planes | `GET /plans`, `GET /plans/:id`, `POST /plans`, `PUT /plans/:id`, `DELETE /plans/:id` |
| Membresías | `GET /memberships`, `GET /memberships/:id`, `POST /memberships`, `PATCH /memberships/:id/status`, `DELETE /memberships/:id` |
| Asistencias | `GET /attendances?memberId=:id`, `POST /attendances`, `PATCH /attendances/:id/checkout` |
| Web pública | `GET /public/plans`, `POST /public/registrations/checkout`, `POST /public/registrations` |

La web usa los endpoints públicos para mostrar planes activos y recibir
solicitudes de inscripción y comenzar el checkout recurrente. `POST
/api/public/registrations/checkout` crea un socio inactivo y una suscripción
pendiente, y devuelve un enlace hospedado por Mercado Pago. El socio ingresa
sus datos de pago allí; la aplicación no recibe datos de tarjeta. No se crea
una membresía ni se habilita el acceso hasta que un webhook firmado confirma
el pago aprobado.

Las personas que ya enviaron una solicitud manual (`POST
/api/public/registrations`) pueden recibir su enlace desde **Solicitudes web**
en el panel. El administrador también puede confirmar una solicitud después de
verificar un pago externo. Configura `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` y
`GYM_PUBLIC_URL`, y registra el endpoint de webhooks público HTTPS antes de
habilitar el pago en línea. El prorrateo con el checkout sin plan asociado debe
verificarse en sandbox antes de usar credenciales de producción.

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
- `API_TOKEN`: secreto Bearer para acceder a las rutas de la API
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: base de datos y credenciales administrativas usadas por Docker Compose
- `GYM_DB_USER`, `GYM_DB_PASSWORD`: usuario de base de datos de privilegios limitados usado por la API y creado en la inicialización
- `POSTGRES_PORT`: puerto local publicado para PostgreSQL (por defecto `5432`, solo accesible desde el equipo local)
- `DATABASE_URL`: URL de conexión PostgreSQL
- `CORS_ORIGIN`: orígenes permitidos separados por comas; si se omite, CORS queda desactivado
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: servidor SMTP, puerto, conexión TLS, credenciales y remitente usados para los correos de solicitudes públicas. Usa `SMTP_SECURE=true` normalmente con el puerto 465 y `false` con 587.

Configura estas variables en el `.env` del backend antes de aceptar solicitudes.
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
