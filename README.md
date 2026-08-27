# Employee Portal V5 — Merit List + Class ID + Phone Verification

## New employee identity workflow

IPI is no longer required when the employee first submits data.

Employee begins with:

- MERITLIST_ID
- CLASS_ID
- PHONE

If no existing record exists for the Merit List ID + Class ID and an ACTIVE batch exists, the employee can submit data.

The server stores an internal primary key:

```text
EMP_ENTRY_ID
```

Admin later assigns IPI.

## Admin IPI assignment

Admin panel:

```text
/admin
```

Employee List shows:

- Merit List ID
- Class ID
- IPI
- Name
- Phone
- Batch

Admin clicks:

```text
Assign IPI
```

The API updates both:

```text
UP_EMP.IPI
HR_EMPEXAMDET.EMPCODE
```

inside one database transaction.

## Employee verification for edit

Existing employee must provide all three correctly:

```text
MERITLIST_ID
CLASS_ID
PHONE
```

The server checks:

```sql
WHERE MERITLIST_ID = ?
  AND CLASS_ID = ?
  AND PHONE = ?
```

If Merit List ID + Class ID exist but phone does not match, access is denied.

## Batch rules remain

Normal update:

```text
Employee's batch = ACTIVE
        ↓
MERITLIST_ID + CLASS_ID + PHONE verified
        ↓
EDIT ALLOWED
```

Inactive batch:

```text
Verified employee
        ↓
VIEW ONLY
        ↓
Request Update Access
        ↓
Admin Approves
        ↓
24-hour update window
```

## Why EMP_ENTRY_ID is required

Before admin assigns IPI, education rows still need a reliable relation.

Therefore:

```text
UP_EMP.EMP_ENTRY_ID
        │
        └── HR_EMPEXAMDET.EMP_ENTRY_ID
```

IPI is nullable initially:

```text
UP_EMP.IPI = NULL
```

After admin assignment:

```text
UP_EMP.IPI = IPI000123
HR_EMPEXAMDET.EMPCODE = IPI000123
```

## MySQL important indexes

```text
UNIQUE (MERITLIST_ID, CLASS_ID)
UNIQUE (IPI)
INDEX  (MERITLIST_ID, CLASS_ID, PHONE)
```

## Production security

Merit List ID + Class ID + Phone is much better than IPI-only lookup, but for highly sensitive employee data you should still consider OTP verification later.

Recommended final authentication:

```text
Merit List ID
+ Class ID
+ Phone
+ OTP
```

## Run locally

Install dependencies once:

```bash
cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env` from `backend/.env.example` and configure either your
local MySQL server or your Aiven MySQL credentials. For Aiven, set `DB_SSL=true`.

Start the API in one terminal:

```bash
cd backend
npm run dev
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The Vite dev
server proxies `/api` requests to `http://localhost:3000`, so no frontend API
environment variable is required for local development.

## Deploy to Vercel with Aiven MySQL

Deploy two Vercel projects from this repository:

| Project | Root directory | Required production variables |
| --- | --- | --- |
| API | `backend` | `NODE_ENV=production`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=employee_portal`, `DB_SSL=true`, `JWT_SECRET`, `FRONTEND_ORIGIN=https://YOUR-FRONTEND.vercel.app` |
| Web | `frontend` | `VITE_API_URL=https://YOUR-BACKEND.vercel.app/api` |

Redeploy each project whenever its environment variables change. Do not use
`localhost` in a Vercel environment variable. `FRONTEND_ORIGIN` must be the
exact frontend origin. A trailing slash is accepted, but this is the preferred
form: `https://YOUR-FRONTEND.vercel.app`.

If Aiven requires its private CA certificate, add `DB_SSL_CA` to the API
project. Its value is the complete PEM content, including the `BEGIN
CERTIFICATE` and `END CERTIFICATE` lines. Multiline text and literal `\n` line
breaks are both supported.

To create the initial admin against the production database, download the API
project's Vercel Production variables locally, run the command below from
`backend`, then remove the downloaded `.env` file:

```bash
npx vercel env pull .env --environment=production
npm run admin:create -- admin "use-a-strong-password" "Administrator"
```

## Migration note

This V5 schema differs from the earlier version.

For a new/test database, simply run:

```bash
mysql -u root -p < database/schema.sql
```

If you already have real data in the earlier MySQL schema, do not drop it. Create a migration script instead.
