// Load .env (if present) before anything else reads process.env — e.g. ANTHROPIC_API_KEY for the
// AI forensic check (verification/aiForensics.js). Uses Node's built-in env-file loader (no new
// dependency); silently does nothing if .env doesn't exist, which is the normal state until someone
// copies .env.example -> .env and fills in a real key.
try {
  process.loadEnvFile();
} catch {
  // no .env file present - fine, everything that reads process.env just sees it unset
}

const express = require('express');
const session = require('express-session');
const path = require('path');

const { initSchema } = require('./db/schema');

// Create tables BEFORE any route module is required: some routes (e.g. certificates.js) run queries at load time.
initSchema();

const { seedCatalog } = require('./db/seedCatalog');
const { router: authRouter } = require('./routes/auth');
const classesRouter = require('./routes/classes');
const certificatesRouter = require('./routes/certificates');
const catalogRouter = require('./routes/catalog');
const issuerSessionsRouter = require('./routes/issuerSessions');
const issuersRouter = require('./routes/issuers');
const adminRouter = require('./routes/admin');
const teachingRouter = require('./routes/teaching');
const chatRouter = require('./routes/chat');
const { seedAdmin } = require('./db/seedAdmin');
const { seedIssuers } = require('./db/seedIssuers');

seedAdmin(); // first-run admin account; no-op once an admin exists (db/seedAdmin.js)
seedCatalog();
seedIssuers(); // well-known issuers (typeahead + link recognition). INSERT OR IGNORE: never overwrites admin edits.

const app = express();
app.use(express.json());
app.use(session({
  secret: 'campus-credential-trust-dev-secret', // fine for local dev; move to env var before any real deployment
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use('/api/auth', authRouter);
app.use('/api/classes', classesRouter);
app.use('/api/certificates', certificatesRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/issuer-sessions', issuerSessionsRouter);
app.use('/api/issuers', issuersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/teaching', teachingRouter);
app.use('/api/chat', chatRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Credential Trust Platform running at http://localhost:${PORT}`);
});
