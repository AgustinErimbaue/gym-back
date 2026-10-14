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

## Endpoints

Todas las rutas están bajo `/api`. Los errores se devuelven como JSON. Todas las
rutas excepto `GET /api/health` requieren el encabezado
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

### Ejemplos

Crear un socio:

```json
{
  "firstName": "Ana",
  "lastName": "Pérez",
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
- `API_TOKEN`: secreto Bearer para acceder a las rutas de la API
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: base de datos y credenciales administrativas usadas por Docker Compose
- `GYM_DB_USER`, `GYM_DB_PASSWORD`: usuario de base de datos de privilegios limitados usado por la API y creado en la inicialización
- `POSTGRES_PORT`: puerto local publicado para PostgreSQL (por defecto `5432`, solo accesible desde el equipo local)
- `DATABASE_URL`: URL de conexión PostgreSQL
- `CORS_ORIGIN`: orígenes permitidos separados por comas; si se omite, CORS queda desactivado
