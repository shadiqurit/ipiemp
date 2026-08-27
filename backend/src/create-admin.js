import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const [username, password, displayName = 'Administrator'] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: npm run admin:create -- <username> <password> [displayName]');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

await pool.execute(
  `INSERT INTO ADMIN_USER (USERNAME, PASSWORD_HASH, DISPLAY_NAME)
   VALUES (?, ?, ?)
   ON DUPLICATE KEY UPDATE PASSWORD_HASH = VALUES(PASSWORD_HASH),
                           DISPLAY_NAME = VALUES(DISPLAY_NAME),
                           ACTIVE_YN = 'Y'`,
  [username, hash, displayName]
);

console.log(`Admin user "${username}" created/updated.`);
await pool.end();
