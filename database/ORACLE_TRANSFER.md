# Admin transfer from MySQL to Oracle

The Employee List has a **Transfer to Oracle** button. It uses the API server's
existing MySQL connection (`DB_*`) as the source. For emp.shadiqur.bd, deploy
this feature on that site's API server and verify that its `DB_*` values point
to the site's production MySQL database. A website URL is not a database
connection.

## Oracle 19c on your local Windows PC

Use **Oracle on my local PC** in the transfer dialog, then **Download for
local Oracle**. This downloads a JSON file containing a consistent snapshot
of the selected employees and their two child tables. The website needs no
Oracle credentials for this option. Install this updated application on the
website before using the new download button.

Downloads use compressed JSON when the browser supports it, show received
file size and can be canceled. The export has a 20-second server deadline;
the browser waits at most 30 seconds. A database stall returns an error
instead of leaving the download waiting for minutes. Server logs include
`Oracle export completed` with duration, file size and row counts, or
`Oracle export timed out` with the stage (`authorization`, `waiting for
MySQL`, `reading employee tables`, or `preparing file`). These logs exclude
employee records and credentials.

On your local Oracle PC, install Node.js 22 or newer and copy the `backend`
folder (without `node_modules`) from this project. In PowerShell, enter that
folder and set up the importer:

```powershell
npm ci --omit=dev
Copy-Item oracle-local.env.example .env.oracle
Copy-Item oracle-transfer.mapping.example.json oracle-transfer.mapping.json
```

Edit `.env.oracle` with the local Oracle username, password, schema and actual
service/PDB name. For Oracle on this same PC, the connection is
`localhost:1521/YOUR_SERVICE_NAME`; replace the placeholder and use the actual
listener port. Credentials stay on this PC. No MySQL connection is needed
by the local importer.

Your three Oracle tables already exist. Review the mapping against them;
run `database/oracle_table_metadata.sql` as the table owner to retrieve
the column definitions and keys. The importer checks them before saving.

If your Oracle tables use the portal's `EMP_ENTRY_ID` and `FAMILY_ID` columns,
use the matching template instead:

```powershell
Copy-Item oracle-transfer.portal-schema.example.json oracle-transfer.mapping.json
```

This template preserves source relational IDs and approval fields. It matches
employees by `EMP_ENTRY_ID`, education by `EMP_ENTRY_ID` + `SLNO`, and family
rows by `EMP_ENTRY_ID` + `CHILD_NOS`. Use it when Oracle is a copy of this
portal's schema and source IDs identify the same employees in both databases.

For each download, preview first, then save:

```powershell
npm run oracle:import -- "C:\Users\YOUR_USER\Downloads\employee-oracle-FILENAME.json" --preview
npm run oracle:import -- "C:\Users\YOUR_USER\Downloads\employee-oracle-FILENAME.json" --save
```

Use the exact downloaded filename. Preview connects to your local Oracle
and displays destination row counts without writing them. `--save` validates
the file and mapping again, merges all three tables, and commits them together.
It updates matching rows when repeated. Download a fresh file for later
updates; importing an older export can restore its older field values.
Run one local import at a time.

The file contains employee data; keep it in your local data storage. Export
filenames are excluded from this repository's Git tracking. No Oracle listener
needs to be exposed to the website or public internet for this workflow.

## Direct website-to-Oracle connection (optional)

1. Run `npm ci --omit=dev` in `backend` to install the Oracle driver, and build
   the frontend with `npm ci` and `npm run build` in `frontend`.
2. Copy `backend/oracle-transfer.mapping.example.json` to
   `backend/oracle-transfer.mapping.json`. Review it against the actual Oracle
   table definitions. This example is based on the portal's export fields;
   it is **not a verified definition of your Oracle tables**.
3. Each mapping entry specifies the Oracle table name and maps MySQL column
   names to Oracle column names. Target names must be ordinary uppercase
   identifiers. Remove optional portal fields only when they deliberately
   should not be transferred; rename target columns as needed. The example
   excludes portal internal IDs and approval fields.
4. Configure these server environment variables (never frontend variables):

   ```dotenv
   ORACLE_TRANSFER_ENABLED=true
   ORACLE_USER=portal_importer
   ORACLE_PASSWORD=YOUR_PASSWORD
   ORACLE_CONNECT_STRING=db-host:1521/service_name
   ORACLE_SCHEMA=HR
   ORACLE_TRANSFER_MAPPING_PATH=/absolute/path/to/oracle-transfer.mapping.json
   ```

5. Restart the API. Its host must be able to reach the Oracle listener. The
   implementation uses node-oracledb Thin mode; check that the Oracle version
   and authentication configuration support it. Oracle 11g requires a
   different driver setup and is not supported by this implementation.

Do not put credentials in the mapping file or browser. The local mapping
filename is ignored by Git. The feature stays disabled until explicitly
configured. No database tables are created or altered by the transfer.

## Required matching keys

| MySQL table | Source matching key | Typical Oracle key |
| --- | --- | --- |
| up_emp | IPI | IPI |
| hr_empexamdet | EMPCODE + SLNO | EMPCODE + SLNO |
| hr_empfamilydet | EMPCODE + CHILD_NOS | EMPCODE + CHILD_NOS |

Every matching key must be included in the mapping. Oracle must have an
enabled, validated primary or unique constraint on exactly the corresponding
target columns. Review existing data and keys with the Oracle administrator
before adding any constraints. The Oracle account needs metadata visibility
and SELECT, INSERT and UPDATE access for all three destination tables.

A table mapping may specify a `keys` array of MySQL column names to use your
existing Oracle primary/unique key, for example `"keys": ["EMP_ENTRY_ID"]`.
Those columns must also appear in `columns`. If omitted, the IPI/EMPCODE
matching keys in the table above are used.

Preflight rejects missing columns, generated mapped columns, unsupported
types, required unmapped columns without defaults, and missing unique keys.
Supported types are VARCHAR2, NVARCHAR2, CHAR, NCHAR, NUMBER, FLOAT, DATE and
TIMESTAMP without time zone. Dates use explicit conversion masks; Oracle
stores empty strings as NULL. Integer values outside JavaScript's safe range
are rejected. Oracle enforces length, precision, valid dates, checks, foreign
keys and other data constraints during the actual transfer. Preview is not a
trial insert and cannot verify these constraints or all trigger behavior.

## Transfer workflow

1. Log in as Admin or Super Admin. Filter the Employee List by batch/search.
2. Click **Transfer to Oracle**, then select up to 100 employees with assigned
   IPIs. Approval status does not restrict the transfer. Employees without IPI
   are excluded, including drafts awaiting assignment. Selection is separate
   from the approval checkboxes. Clear the Employee List search filters first
   to include every batch and employee in your selection.
3. Click **Preview transfer** to check the connection, mapping and matching
   keys and review destination row counts.
4. Click **Save to Oracle**. The preview expires after ten minutes; source
   data, selection or destination changes require another preview.

The source is read in a consistent MySQL transaction. Child EMPCODE values
must match the parent IPI. UP_EMP is merged first, followed by HR_EMPEXAMDET
and HR_EMPFAMILYDET, all in one Oracle transaction. Any failed write causes a
rollback. Repeat transfers update matching rows and insert new rows. No
MySQL records are changed. Transfers sharing the same MySQL server are
serialized with a connection-scoped advisory lock.

Rows removed from MySQL remain in Oracle. Changing a configured matching key
creates a new matching identity and leaves the previous Oracle record in place;
reconcile such changes separately. With the portal-schema template, IPI is an
updated field rather than a matching key. The transfer updates
only the columns explicitly mapped, including nulls. Oracle triggers with
autonomous transactions or external side effects require separate review.

The success message is sent only after Oracle commit returns. If a connection
or HTTP response is lost during commit, the outcome may be uncertain. Check
Oracle or wait and retry the same selection; unique matching keys prevent
duplicate identities. Proxy/server request timeouts must accommodate the
selected batch; choose smaller groups for slower database links. The API
logs successful table row counts and administrator ID, and logs driver error
codes on failure without logging credentials or employee records.

Live verification still requires the actual Oracle connection and table
definitions. Automated tests use database doubles; they do not substitute
for an end-to-end test against the destination Oracle instance.

Driver references: [transactions](https://node-oracledb.readthedocs.io/en/latest/user_guide/txn_management.html)
and [Thin mode requirements](https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html).
