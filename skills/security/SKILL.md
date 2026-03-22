---
name: security
description: "OWASP Top 10 defenses, XSS prevention, SQL injection with parameterized queries, CSRF, auth best practices, secrets management, CORS, input validation, and security headers."
domain: security
version: "1.0"
---

# Security Reference Dictionary

## XSS Prevention

### Understanding XSS Types

```
Stored XSS: Malicious script saved in database, served to other users
  Example: User saves <script>steal(cookies)</script> as their bio
  Every visitor sees and executes the script

Reflected XSS: Malicious script in URL/request, reflected in response
  Example: https://site.com/search?q=<script>alert(1)</script>
  Server includes the query in the page without escaping

DOM-based XSS: Script manipulates DOM using untrusted data
  Example: document.innerHTML = location.hash.slice(1)
  Attacker crafts URL: https://site.com/page#<img onerror=alert(1)>
```

### Output Encoding

```javascript
// RULE: Always encode output based on the context

// HTML context: encode HTML entities
function escapeHtml(str) {
  const map = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#x27;', '/': '&#x2F;',
  };
  return str.replace(/[&<>"'/]/g, (c) => map[c]);
}

// Or use a library
const { escape } = require('lodash');
const sanitized = escape(userInput);

// Template engines auto-escape by default:
// EJS: <%= userInput %> (escaped) vs <%- userInput %> (raw - DANGEROUS)
// Handlebars: {{userInput}} (escaped) vs {{{userInput}}} (raw - DANGEROUS)
// Jinja2: {{userInput}} (escaped) vs {{userInput|safe}} (raw - DANGEROUS)
// React JSX: {userInput} (escaped automatically)

// URL context: encode URL components
const safeUrl = `https://example.com/search?q=${encodeURIComponent(userInput)}`;

// JavaScript context: JSON encode
const safeJson = JSON.stringify(userInput);
// In template: <script>var data = ${JSON.stringify(data)};</script>

// CSS context: only allow known-safe values
// NEVER: element.style.color = userInput;
// SAFE: validate against allowlist
const allowedColors = ['red', 'blue', 'green'];
if (allowedColors.includes(userInput)) {
  element.style.color = userInput;
}
```

### Content Security Policy (CSP)

```javascript
// Express.js CSP header
const helmet = require('helmet');

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'nonce-{RANDOM}'"],  // nonce for inline scripts
    styleSrc: ["'self'", "'unsafe-inline'"],      // needed for many CSS frameworks
    imgSrc: ["'self'", "data:", "https://cdn.example.com"],
    connectSrc: ["'self'", "https://api.example.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    objectSrc: ["'none'"],       // no plugins (Flash, Java)
    mediaSrc: ["'none'"],
    frameSrc: ["'none'"],        // no iframes
    baseUri: ["'self'"],         // prevent base tag injection
    formAction: ["'self'"],      // forms can only submit to same origin
    frameAncestors: ["'none'"],  // can't be embedded (clickjacking prevention)
    upgradeInsecureRequests: [], // upgrade HTTP to HTTPS
  },
}));

// Nonce-based CSP for inline scripts
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// In template:
// <script nonce="<%= nonce %>">
//   // This inline script is allowed because of the nonce
// </script>

// CSP report-only mode (monitor before enforcing)
app.use(helmet.contentSecurityPolicy({
  directives: { /* ... */ },
  reportOnly: true,  // don't block, just report violations
}));
```

### React/Frontend XSS Prevention

```javascript
// React is safe by default (auto-escapes JSX)
return <div>{userInput}</div>; // SAFE: auto-escaped

// DANGEROUS: dangerouslySetInnerHTML
return <div dangerouslySetInnerHTML={{ __html: userInput }} />; // XSS!

// If you MUST render HTML, sanitize first
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userHtml, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
  ALLOWED_ATTR: ['href', 'target'],
});
return <div dangerouslySetInnerHTML={{ __html: clean }} />;

// URL sanitization (prevent javascript: protocol)
function sanitizeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return '#'; // block javascript:, data:, etc.
    }
    return url;
  } catch {
    return '#';
  }
}
// <a href={sanitizeUrl(userUrl)}>Link</a>
```

## SQL Injection Prevention

### Parameterized Queries

```javascript
// NEVER concatenate user input into SQL
// BAD (SQL injection vulnerable):
const result = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
// Input: ' OR '1'='1' --
// Becomes: SELECT * FROM users WHERE email = '' OR '1'='1' --'

// GOOD: Parameterized query (Node.js pg)
const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);

// GOOD: Parameterized query (mysql2)
const [rows] = await connection.execute(
  'SELECT * FROM users WHERE email = ? AND status = ?',
  [email, status]
);

// GOOD: Query builder (Knex)
const users = await knex('users')
  .where({ email, status: 'active' })
  .select('id', 'name', 'email');

// GOOD: ORM (Prisma)
const user = await prisma.user.findUnique({ where: { email } });

// GOOD: ORM (Sequelize)
const user = await User.findOne({ where: { email } });
```

```python
# Python: Parameterized queries

# BAD (SQL injection vulnerable):
cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")

# GOOD: psycopg2 (PostgreSQL)
cursor.execute("SELECT * FROM users WHERE email = %s", (email,))

# GOOD: psycopg3
cursor.execute("SELECT * FROM users WHERE email = %(email)s", {"email": email})

# GOOD: SQLAlchemy
from sqlalchemy import text
result = session.execute(
    text("SELECT * FROM users WHERE email = :email"),
    {"email": email}
)

# GOOD: SQLAlchemy ORM
user = session.query(User).filter(User.email == email).first()

# GOOD: Django ORM
user = User.objects.get(email=email)
# Django raw queries (still parameterized):
User.objects.raw("SELECT * FROM users WHERE email = %s", [email])
```

```go
// Go: Parameterized queries

// BAD:
db.Query("SELECT * FROM users WHERE email = '" + email + "'")

// GOOD: database/sql with placeholders
row := db.QueryRow("SELECT id, name FROM users WHERE email = $1", email)

// GOOD: sqlx
var user User
err := db.Get(&user, "SELECT * FROM users WHERE email = $1", email)

// GOOD: GORM
db.Where("email = ?", email).First(&user)
```

### Dynamic Query Building

```javascript
// When you need dynamic WHERE clauses, use a query builder
// NEVER build SQL strings from user input

function buildSearchQuery(filters) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (filters.name) {
    conditions.push(`name ILIKE $${paramIndex++}`);
    params.push(`%${filters.name}%`);
  }

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }

  if (filters.minAge) {
    conditions.push(`age >= $${paramIndex++}`);
    params.push(filters.minAge);
  }

  // Whitelist allowed sort columns
  const allowedSorts = ['name', 'created_at', 'age'];
  const sortColumn = allowedSorts.includes(filters.sort) ? filters.sort : 'created_at';
  const sortDir = filters.order === 'asc' ? 'ASC' : 'DESC';

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM users ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT $${paramIndex}`;
  params.push(filters.limit || 20);

  return { sql, params };
}

// Knex query builder (safer and cleaner)
function buildSearch(filters) {
  let query = knex('users').select('*');

  if (filters.name) {
    query = query.where('name', 'ilike', `%${filters.name}%`);
  }
  if (filters.status) {
    query = query.where('status', filters.status);
  }
  if (filters.minAge) {
    query = query.where('age', '>=', filters.minAge);
  }

  const allowedSorts = ['name', 'created_at', 'age'];
  const sort = allowedSorts.includes(filters.sort) ? filters.sort : 'created_at';
  query = query.orderBy(sort, filters.order === 'asc' ? 'asc' : 'desc');

  return query.limit(Math.min(filters.limit || 20, 100));
}
```

## CSRF Prevention

### Token-Based CSRF Protection

```javascript
// Express.js CSRF protection
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: { httpOnly: true, sameSite: 'strict' } });

// Apply to state-changing routes
app.get('/form', csrfProtection, (req, res) => {
  res.render('form', { csrfToken: req.csrfToken() });
});

app.post('/transfer', csrfProtection, (req, res) => {
  // CSRF token is automatically validated by middleware
  processTransfer(req.body);
});

// In the form template:
// <form method="POST" action="/transfer">
//   <input type="hidden" name="_csrf" value="<%= csrfToken %>">
//   ...
// </form>

// For AJAX requests: send token in header
// <meta name="csrf-token" content="<%= csrfToken %>">
// fetch('/api/transfer', {
//   method: 'POST',
//   headers: {
//     'CSRF-Token': document.querySelector('meta[name="csrf-token"]').content,
//     'Content-Type': 'application/json',
//   },
//   body: JSON.stringify(data),
// });
```

### SameSite Cookies

```javascript
// Modern CSRF prevention: SameSite cookie attribute
res.cookie('session', sessionId, {
  httpOnly: true,     // not accessible via JavaScript
  secure: true,       // only sent over HTTPS
  sameSite: 'lax',    // not sent on cross-origin POST (prevents CSRF)
  maxAge: 24 * 60 * 60 * 1000,  // 24 hours
  path: '/',
  domain: '.example.com',
});

// SameSite values:
// 'strict': Cookie never sent cross-origin (breaks links from other sites)
// 'lax': Sent on top-level navigation GET but NOT on POST (good default)
// 'none': Sent cross-origin (requires Secure; needed for cross-site APIs)

// For APIs: Use Authorization header (Bearer token) instead of cookies
// This is inherently CSRF-safe because browsers don't auto-attach custom headers
```

### Double Submit Cookie Pattern

```javascript
// For stateless CSRF protection (no server-side session)
function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    // Generate and set CSRF cookie on read requests
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf', token, { httpOnly: false, sameSite: 'strict', secure: true });
    req.csrfToken = token;
    return next();
  }

  // Validate on state-changing requests
  const cookieToken = req.cookies.csrf;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }

  next();
}

// Client sends the cookie value in a header:
// fetch('/api/transfer', {
//   method: 'POST',
//   headers: {
//     'X-CSRF-Token': getCookie('csrf'),
//     'Content-Type': 'application/json',
//   },
//   credentials: 'same-origin',
//   body: JSON.stringify(data),
// });
```

## Authentication Best Practices

### Password Hashing

```javascript
// ALWAYS use bcrypt, scrypt, or argon2 (NEVER MD5, SHA-1, SHA-256 alone)

// bcrypt (most widely used)
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;  // increase over time as hardware improves

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// argon2 (recommended for new projects, winner of Password Hashing Competition)
const argon2 = require('argon2');

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,  // recommended variant
    memoryCost: 65536,      // 64 MB
    timeCost: 3,            // iterations
    parallelism: 4,         // threads
  });
}

async function verifyPassword(password, hash) {
  return argon2.verify(hash, password);
}
```

```python
# Python: password hashing
import bcrypt
from argon2 import PasswordHasher

# bcrypt
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# argon2 (recommended)
ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
)

def hash_password(password: str) -> str:
    return ph.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    try:
        return ph.verify(hashed, password)
    except Exception:
        return False

# Django: uses PBKDF2 by default; upgrade to argon2:
# settings.py
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",  # fallback for existing hashes
]
```

### Session Management

```javascript
// Secure session configuration
const session = require('express-session');
const RedisStore = require('connect-redis').default;

app.use(session({
  store: new RedisStore({ client: redisClient }),
  name: 'sid',  // don't use default 'connect.sid' (fingerprinting)
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,  // HTTPS only
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    domain: '.example.com',
  },
}));

// Session lifecycle
app.post('/auth/login', async (req, res) => {
  const user = await authenticateUser(req.body.email, req.body.password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Regenerate session ID after login (prevent session fixation)
  req.session.regenerate((err) => {
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.loginAt = Date.now();
    res.json({ success: true });
  });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('sid');
    res.json({ success: true });
  });
});

// Session validation middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Check session age (force re-auth after 8 hours)
  const maxAge = 8 * 60 * 60 * 1000;
  if (Date.now() - req.session.loginAt > maxAge) {
    req.session.destroy(() => {
      res.status(401).json({ error: 'Session expired' });
    });
    return;
  }

  next();
}
```

### Multi-Factor Authentication (MFA)

```javascript
// TOTP (Time-based One-Time Password) implementation
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

// Setup MFA
app.post('/auth/mfa/setup', requireAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: `MyApp (${req.user.email})`,
    issuer: 'MyApp',
  });

  // Store the secret temporarily (not yet verified)
  await db.users.update({
    where: { id: req.user.id },
    data: { mfaPendingSecret: secret.base32 },
  });

  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ qrCode: qrCodeUrl, secret: secret.base32 });
});

// Verify and enable MFA
app.post('/auth/mfa/verify', requireAuth, async (req, res) => {
  const user = await db.users.findUnique({ where: { id: req.user.id } });

  const verified = speakeasy.totp.verify({
    secret: user.mfaPendingSecret,
    encoding: 'base32',
    token: req.body.code,
    window: 1,  // allow 1 step tolerance (30 seconds)
  });

  if (!verified) {
    return res.status(400).json({ error: 'Invalid code' });
  }

  // Generate backup codes
  const backupCodes = Array.from({ length: 10 }, () =>
    crypto.randomBytes(4).toString('hex')
  );
  const hashedCodes = await Promise.all(
    backupCodes.map((code) => bcrypt.hash(code, 10))
  );

  await db.users.update({
    where: { id: req.user.id },
    data: {
      mfaSecret: user.mfaPendingSecret,
      mfaPendingSecret: null,
      mfaEnabled: true,
      mfaBackupCodes: hashedCodes,
    },
  });

  res.json({ backupCodes }); // show once, never again
});

// Login with MFA
app.post('/auth/login', async (req, res) => {
  const user = await authenticateUser(req.body.email, req.body.password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.mfaEnabled) {
    // Create temporary session, require MFA
    const tempToken = jwt.sign({ sub: user.id, mfaPending: true }, SECRET, { expiresIn: '5m' });
    return res.json({ mfaRequired: true, tempToken });
  }

  // No MFA, proceed with login
  createSession(req, user);
  res.json({ success: true });
});

app.post('/auth/mfa/validate', async (req, res) => {
  const payload = jwt.verify(req.body.tempToken, SECRET);
  if (!payload.mfaPending) return res.status(400).json({ error: 'Invalid token' });

  const user = await db.users.findUnique({ where: { id: payload.sub } });

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    encoding: 'base32',
    token: req.body.code,
    window: 1,
  });

  if (!verified) {
    return res.status(401).json({ error: 'Invalid MFA code' });
  }

  createSession(req, user);
  res.json({ success: true });
});
```

## Secrets Management

### Environment Variables

```bash
# NEVER commit secrets to source control
# .gitignore
.env
.env.*
!.env.example

# .env.example (commit this, with placeholder values)
DATABASE_URL=postgres://user:password@localhost:5432/myapp
JWT_SECRET=change-me-in-production
API_KEY=your-api-key-here

# Load with dotenv (development only)
# In production, set env vars through your platform (AWS, GCP, Docker, etc.)
```

```javascript
// Validate required env vars at startup
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  port: parseInt(process.env.PORT || '3000'),
};

// Don't log secrets
console.log('Config loaded:', {
  databaseUrl: config.databaseUrl.replace(/\/\/.*@/, '//***@'),  // mask credentials
  port: config.port,
});
```

### Secret Rotation

```javascript
// JWT secret rotation with grace period
const secrets = {
  current: process.env.JWT_SECRET_CURRENT,
  previous: process.env.JWT_SECRET_PREVIOUS,  // still valid during rotation
};

// Sign with current secret
function signToken(payload) {
  return jwt.sign(payload, secrets.current, { expiresIn: '15m' });
}

// Verify with either secret (grace period)
function verifyToken(token) {
  try {
    return jwt.verify(token, secrets.current);
  } catch {
    return jwt.verify(token, secrets.previous);  // try old secret
  }
}

// Rotation process:
// 1. Generate new secret
// 2. Set JWT_SECRET_PREVIOUS = JWT_SECRET_CURRENT
// 3. Set JWT_SECRET_CURRENT = new secret
// 4. Deploy (both secrets accepted during rollout)
// 5. After all old tokens expire, remove previous secret
```

### Vault Integration

```javascript
// HashiCorp Vault client
const vault = require('node-vault')({
  endpoint: process.env.VAULT_ADDR,
  token: process.env.VAULT_TOKEN,
});

async function loadSecrets() {
  const result = await vault.read('secret/data/myapp/production');
  return result.data.data;
  // Returns: { database_url: '...', jwt_secret: '...', ... }
}

// AWS Secrets Manager
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

async function getSecret(secretName) {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  return JSON.parse(response.SecretString);
}

// Google Secret Manager
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

async function getSecret(name) {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({ name: `projects/my-project/secrets/${name}/versions/latest` });
  return version.payload.data.toString('utf8');
}
```

## Input Validation

### Server-Side Validation

```javascript
// Zod: TypeScript-first schema validation
const { z } = require('zod');

const CreateUserSchema = z.object({
  email: z.string().email().max(255).trim().toLowerCase(),
  name: z.string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .trim()
    .regex(/^[a-zA-Z\s\-']+$/, 'Name contains invalid characters'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[a-z]/, 'Must contain a lowercase letter')
    .regex(/[0-9]/, 'Must contain a digit'),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['user', 'admin']).default('user'),
  bio: z.string().max(500).optional(),
  website: z.string().url().optional().or(z.literal('')),
}).strict();  // reject unknown fields

// Express middleware
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.body = result.data;  // use parsed/transformed data
    next();
  };
}

app.post('/users', validate(CreateUserSchema), createUser);
```

```python
# Pydantic: Python data validation
from pydantic import BaseModel, EmailStr, Field, field_validator
import re

class CreateUserRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    age: int | None = Field(None, ge=0, le=150)
    role: str = Field("user", pattern=r"^(user|admin)$")
    bio: str | None = Field(None, max_length=500)

    model_config = {"extra": "forbid"}  # reject unknown fields

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if not re.match(r"^[a-zA-Z\s\-']+$", v):
            raise ValueError("Name contains invalid characters")
        return v.strip()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Must contain an uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Must contain a lowercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Must contain a digit")
        return v

# FastAPI uses Pydantic automatically
@app.post("/users")
async def create_user(user: CreateUserRequest):
    # user is already validated and typed
    return await service.create_user(user)
```

### Path Traversal Prevention

```javascript
// NEVER use user input directly in file paths

// BAD:
app.get('/files/:name', (req, res) => {
  res.sendFile(`/uploads/${req.params.name}`);  // Path traversal!
  // Attack: GET /files/../../etc/passwd
});

// GOOD: Validate and resolve path
const path = require('path');

app.get('/files/:name', (req, res) => {
  const uploadsDir = path.resolve('/app/uploads');
  const filePath = path.resolve(uploadsDir, req.params.name);

  // Ensure resolved path is within uploads directory
  if (!filePath.startsWith(uploadsDir + path.sep)) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  res.sendFile(filePath);
});

// Also validate the filename itself
function sanitizeFilename(name) {
  // Remove path separators and null bytes
  return name
    .replace(/[/\\]/g, '')
    .replace(/\0/g, '')
    .replace(/\.\./g, '');
}
```

### Rate Limiting for Auth Endpoints

```javascript
// Aggressive rate limiting on authentication endpoints
const rateLimit = require('express-rate-limit');

// Login: strict limits
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts per window
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body.email || req.ip,  // per-email limiting
  skipSuccessfulRequests: true,  // don't count successful logins
});
app.post('/auth/login', loginLimiter, loginHandler);

// Password reset: even stricter
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 3,                     // 3 attempts per hour
  keyGenerator: (req) => req.body.email || req.ip,
});
app.post('/auth/reset-password', resetLimiter, resetHandler);

// Account creation
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.ip,
});
app.post('/auth/signup', signupLimiter, signupHandler);

// Global API rate limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,  // 100 requests per minute
});
app.use('/api/', apiLimiter);
```

## Security Headers

### Essential Headers

```javascript
// Use helmet.js for Express (sets most headers automatically)
const helmet = require('helmet');
app.use(helmet());

// Or set manually:
app.use((req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Or allow same-origin framing: 'SAMEORIGIN'

  // Enable XSS filter (legacy browsers)
  res.setHeader('X-XSS-Protection', '0');
  // Note: Modern recommendation is to disable it and rely on CSP

  // Enforce HTTPS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict browser features
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()');

  // Prevent caching of sensitive pages
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  next();
});
```

```python
# Django security settings
# settings.py

SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = True

# CSP with django-csp
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = ("'self'",)
CSP_STYLE_SRC = ("'self'", "'unsafe-inline'")
CSP_IMG_SRC = ("'self'", "data:", "https://cdn.example.com")
```

### CORS Security

```javascript
// Secure CORS configuration
const cors = require('cors');

const allowedOrigins = new Set([
  'https://myapp.com',
  'https://www.myapp.com',
  'https://staging.myapp.com',
]);

// Development origins
if (process.env.NODE_ENV === 'development') {
  allowedOrigins.add('http://localhost:3000');
  allowedOrigins.add('http://localhost:5173');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error(`CORS not allowed for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
  maxAge: 86400,  // 24h preflight cache
}));

// CRITICAL: Never use origin: '*' with credentials: true
// Browsers reject this combination
```

## OWASP Top 10 Defenses

### Broken Access Control (A01)

```javascript
// Enforce authorization at every layer

// 1. RBAC (Role-Based Access Control)
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

app.delete('/users/:id', authorize('admin'), deleteUser);
app.get('/users', authorize('admin', 'manager'), listUsers);

// 2. Resource-level authorization (IDOR prevention)
app.get('/orders/:id', authenticate, async (req, res) => {
  const order = await db.orders.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  // Verify the requesting user owns this resource
  if (order.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.json(order);
});

// 3. Always filter by user in queries
// BAD: trusts user input for authorization
app.get('/orders', async (req, res) => {
  const orders = await db.orders.findMany({ where: { userId: req.query.userId } });
  // Attacker can change userId in query string!
});

// GOOD: use authenticated user
app.get('/orders', authenticate, async (req, res) => {
  const orders = await db.orders.findMany({ where: { userId: req.user.id } });
  res.json(orders);
});

// 4. ABAC (Attribute-Based Access Control) for complex rules
function canEdit(user, resource) {
  if (user.role === 'admin') return true;
  if (resource.ownerId === user.id) return true;
  if (resource.teamId && user.teamIds.includes(resource.teamId)) {
    return user.teamRole === 'editor' || user.teamRole === 'admin';
  }
  return false;
}
```

### Cryptographic Failures (A02)

```javascript
// 1. Use strong, modern algorithms
const crypto = require('crypto');

// Symmetric encryption: AES-256-GCM (authenticated encryption)
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);  // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();  // authentication tag
  return { iv: iv.toString('hex'), encrypted: encrypted.toString('hex'), tag: tag.toString('hex') };
}

function decrypt(encryptedData, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm',
    key, Buffer.from(encryptedData.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
  return decipher.update(Buffer.from(encryptedData.encrypted, 'hex')) +
    decipher.final('utf8');
}

// 2. NEVER use: MD5, SHA-1, DES, 3DES, RC4, ECB mode
// ALWAYS use: AES-256-GCM, ChaCha20-Poly1305, SHA-256+, bcrypt/argon2 for passwords

// 3. Generate secure random values
const token = crypto.randomBytes(32).toString('hex');  // 256-bit token
const uuid = crypto.randomUUID();

// 4. Constant-time comparison (prevent timing attacks)
function safeCompare(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// 5. TLS: Always use HTTPS
// Force HTTPS redirect
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(301, `https://${req.hostname}${req.url}`);
  }
  next();
});
```

### Injection (A03)

```javascript
// SQL Injection: Use parameterized queries (see SQL Injection section above)

// Command Injection
// BAD:
const { exec } = require('child_process');
exec(`ping ${userInput}`);  // userInput: "8.8.8.8; rm -rf /"

// GOOD: Use execFile with arguments array
const { execFile } = require('child_process');
execFile('ping', ['-c', '4', userInput], (err, stdout) => {
  // Arguments are not interpreted by shell
});

// EVEN BETTER: Validate input
const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
if (!ipRegex.test(userInput)) {
  return res.status(400).json({ error: 'Invalid IP address' });
}

// NoSQL Injection (MongoDB)
// BAD:
db.collection('users').find({ username: req.body.username, password: req.body.password });
// Attack: { "username": "admin", "password": { "$ne": "" } }
// Finds any user where password is not empty!

// GOOD: Type-check inputs
const username = String(req.body.username);  // force string
const password = String(req.body.password);
db.collection('users').find({ username, password: hashedPassword });

// LDAP Injection
// BAD: `(&(uid=${username})(userPassword=${password}))`
// GOOD: Escape special LDAP characters
function escapeLdap(str) {
  return str.replace(/[\\*()\/\0]/g, (c) => `\\${c.charCodeAt(0).toString(16)}`);
}

// Template Injection (SSTI)
// BAD: User input in template engine
// nunjucks.renderString(userInput, data); // RCE!
// GOOD: Never let users control template code
```

### Insecure Design (A04)

```javascript
// 1. Rate limit sensitive operations
// See Rate Limiting section above

// 2. Don't expose internal errors to users
app.use((err, req, res, next) => {
  // Log full error internally
  logger.error({ err, requestId: req.id }, 'Unhandled error');

  // Return generic message to user
  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id,  // for support reference
  });
});

// 3. Implement account lockout
async function handleLoginAttempt(email, password) {
  const user = await db.users.findByEmail(email);
  if (!user) return { success: false };  // don't reveal if user exists

  // Check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { success: false, error: 'Account temporarily locked' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const update = { failedLoginAttempts: attempts };

    if (attempts >= 5) {
      update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);  // 15 min
      update.failedLoginAttempts = 0;
    }

    await db.users.update(user.id, update);
    return { success: false };
  }

  // Successful login: reset counters
  await db.users.update(user.id, { failedLoginAttempts: 0, lockedUntil: null });
  return { success: true, user };
}

// 4. Use allowlists, not denylists
// BAD: Block known bad inputs
const blockedPatterns = [/<script>/i, /javascript:/i];

// GOOD: Allow known good inputs
const allowedTags = ['b', 'i', 'em', 'strong', 'p'];
```

### Security Misconfiguration (A05)

```javascript
// 1. Remove debug/development features in production
if (process.env.NODE_ENV === 'production') {
  app.disable('x-powered-by');
  // Don't use morgan detailed logging
  // Don't expose stack traces
  // Don't enable GraphQL introspection
}

// 2. Set secure defaults
const sessionConfig = {
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
  resave: false,
  saveUninitialized: false,
};

// 3. Directory listing disabled (Express does this by default)
// 4. Custom error pages (don't leak framework info)
// 5. Keep dependencies updated
// npm audit, npm audit fix
// npx npm-check-updates

// 6. Docker: Don't run as root
// 7. Database: Use least-privilege accounts
// 8. Cloud: Review IAM permissions regularly
```

### Vulnerable Components (A06)

```bash
# Check for known vulnerabilities in dependencies

# Node.js
npm audit
npm audit fix
npm audit --production  # only production deps

# Python
pip-audit
safety check

# Go
govulncheck ./...

# General
snyk test
trivy fs .

# Automated: GitHub Dependabot or Renovate Bot
# .github/dependabot.yml
# version: 2
# updates:
#   - package-ecosystem: "npm"
#     directory: "/"
#     schedule:
#       interval: "weekly"
#     reviewers:
#       - "security-team"
```

### Server-Side Request Forgery (A10)

```javascript
// Prevent SSRF: Don't let users control server-side HTTP requests

// BAD: User controls the URL
app.get('/fetch', async (req, res) => {
  const response = await fetch(req.query.url);  // SSRF!
  // Attacker: /fetch?url=http://169.254.169.254/latest/meta-data/
  // (AWS metadata endpoint - leaks credentials!)
});

// GOOD: Validate and restrict URLs
const { URL } = require('url');
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

async function isAllowedUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  // Only allow HTTPS
  if (parsed.protocol !== 'https:') return false;

  // Block internal hostnames
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254'];
  if (blockedHosts.includes(parsed.hostname)) return false;

  // Resolve DNS and check for internal IPs
  try {
    const addresses = await dns.resolve(parsed.hostname);
    for (const addr of addresses) {
      const ip = ipaddr.parse(addr);
      if (ip.range() !== 'unicast') return false;  // block private, loopback, etc.
    }
  } catch {
    return false;
  }

  // Allowlist of permitted domains
  const allowedDomains = ['api.example.com', 'cdn.example.com'];
  if (!allowedDomains.some(d => parsed.hostname.endsWith(d))) {
    return false;
  }

  return true;
}

app.get('/fetch', async (req, res) => {
  if (!await isAllowedUrl(req.query.url)) {
    return res.status(400).json({ error: 'URL not allowed' });
  }
  const response = await fetch(req.query.url, {
    redirect: 'error',  // don't follow redirects (could redirect to internal)
    signal: AbortSignal.timeout(5000),  // timeout
  });
  res.json(await response.json());
});
```

## Secure Development Checklist

### Before Deployment

```
Authentication:
  [ ] Passwords hashed with bcrypt/argon2 (cost factor >= 12)
  [ ] JWT tokens have short expiry (15 min access, 7 day refresh)
  [ ] Session IDs regenerated after login
  [ ] Logout invalidates session/token server-side
  [ ] Rate limiting on login/signup/password-reset endpoints
  [ ] Account lockout after failed attempts

Authorization:
  [ ] Every endpoint has authorization check
  [ ] Resource-level authorization (not just role check)
  [ ] No IDOR vulnerabilities (can't access other users' data by changing ID)
  [ ] Admin endpoints restricted and logged

Input/Output:
  [ ] All user input validated server-side
  [ ] SQL queries parameterized (no string concatenation)
  [ ] HTML output encoded (XSS prevention)
  [ ] File uploads validated (type, size, name sanitized)
  [ ] No path traversal in file operations

Transport:
  [ ] HTTPS enforced (HSTS header set)
  [ ] Secure cookie flags (HttpOnly, Secure, SameSite)
  [ ] CORS properly configured (no wildcard with credentials)
  [ ] CSP header set

Secrets:
  [ ] No secrets in source code or logs
  [ ] Environment variables for configuration
  [ ] API keys have minimum required permissions
  [ ] Secrets rotated on schedule

Dependencies:
  [ ] npm audit / pip-audit clean
  [ ] Dependabot or Renovate enabled
  [ ] Container images scanned for CVEs

Monitoring:
  [ ] Authentication events logged (login, logout, failed attempts)
  [ ] Authorization failures logged
  [ ] Sensitive operations logged (with actor, not with secrets)
  [ ] Error monitoring configured (Sentry, etc.)
```
