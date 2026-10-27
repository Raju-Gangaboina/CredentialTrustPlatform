// Creates the first admin account if none exists. Runs on every server start; does nothing once an
// admin exists.
//
// Credentials come from .env (ADMIN_EMAIL, ADMIN_PASSWORD — see .env.example). If ADMIN_PASSWORD is
// not set, a random one is generated and printed ONCE in the server console, so there is never a
// well-known default password. Set the .env values before the first start if you want to choose them.
//
// SECURITY: this must never promote a row an outsider could have created. Teacher sign-up is open, so
// someone could pre-register the default admin email as a teacher. We therefore only ever promote an
// existing account when ADMIN_EMAIL was set explicitly in .env AND that account is already 'approved'
// (a self-registered signup is always 'pending'). Otherwise we refuse and tell the owner what to do.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./connection');

function seedAdmin() {
  const existing = db.prepare("SELECT id FROM faculty WHERE role = 'admin' LIMIT 1").get();
  if (existing) return;

  const explicitEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const email = explicitEmail || 'admin@campus.local';
  const clash = db.prepare('SELECT id, status FROM faculty WHERE lower(email) = ?').get(email);

  if (clash) {
    if (explicitEmail && clash.status === 'approved') {
      db.prepare("UPDATE faculty SET role = 'admin' WHERE id = ?").run(clash.id);
      console.log(`[admin] Existing approved account ${email} promoted to admin (ADMIN_EMAIL).`);
    } else {
      console.error(`[admin] NO ADMIN CREATED: ${email} is already registered as a normal account. ` +
        'Set ADMIN_EMAIL in .env to a different address (or to an already-approved account you want to promote) and restart.');
    }
    return;
  }

  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (generated) password = crypto.randomBytes(9).toString('base64url');

  db.prepare("INSERT INTO faculty (name, email, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'approved')")
    .run('Administrator', email, bcrypt.hashSync(password, 10));

  if (generated) {
    console.log('==================================================================');
    console.log('  ADMIN ACCOUNT CREATED (shown only this once — save it now)');
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}`);
    console.log('  To choose your own, set ADMIN_EMAIL / ADMIN_PASSWORD in .env');
    console.log('  before the first start, or change them after signing in.');
    console.log('==================================================================');
  } else {
    console.log(`[admin] Admin account created for ${email} (password from ADMIN_PASSWORD).`);
  }
}

module.exports = { seedAdmin };
