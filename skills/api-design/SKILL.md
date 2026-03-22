---
name: api-design
description: "REST conventions, error formats, pagination, versioning, auth patterns (JWT/OAuth2/API keys), rate limiting, CORS, OpenAPI, webhooks, GraphQL basics, and API security."
domain: general
version: "1.0"
---

# API Design Reference Dictionary

## REST Conventions

### Resource Naming

```
# Use nouns (not verbs), plural, lowercase, kebab-case
GET    /users                  # list users
POST   /users                  # create user
GET    /users/123              # get user 123
PUT    /users/123              # replace user 123
PATCH  /users/123              # partial update user 123
DELETE /users/123              # delete user 123

# Nested resources (relationships)
GET    /users/123/orders       # list user 123's orders
POST   /users/123/orders       # create order for user 123
GET    /users/123/orders/456   # get order 456 of user 123

# Limit nesting to 2 levels. Beyond that, use top-level resources:
GET    /orders/456             # instead of /users/123/orders/456
GET    /orders?user_id=123     # filter orders by user

# Actions that don't map to CRUD — use sub-resources or verbs
POST   /users/123/activate     # action on a resource
POST   /orders/456/cancel
POST   /payments/789/refund

# Batch operations
POST   /users/batch            # create multiple
DELETE /users/batch             # delete multiple (IDs in body)
PATCH  /users/batch             # update multiple

# Search (when query params aren't enough)
POST   /users/search           # complex search with body
```

### HTTP Methods and Status Codes

```
# Methods and their semantics:
GET     # Retrieve. Safe (no side effects). Cacheable.
POST    # Create or trigger action. Not idempotent.
PUT     # Replace entire resource. Idempotent.
PATCH   # Partial update. Can be idempotent.
DELETE  # Remove resource. Idempotent.
HEAD    # Like GET but no body (check existence, get metadata).
OPTIONS # CORS preflight / discover allowed methods.

# Success codes:
200 OK                    # GET, PUT, PATCH, DELETE with body
201 Created               # POST that creates a resource (include Location header)
202 Accepted              # Async operation started (processing later)
204 No Content            # DELETE, PUT, PATCH with no response body

# Client error codes:
400 Bad Request           # Validation error, malformed input
401 Unauthorized          # Authentication required (misleading name)
403 Forbidden             # Authenticated but not authorized
404 Not Found             # Resource doesn't exist
405 Method Not Allowed    # Wrong HTTP method
409 Conflict              # State conflict (duplicate, edit conflict)
410 Gone                  # Resource permanently removed (vs 404 = never existed/unknown)
415 Unsupported Media Type # Wrong Content-Type
422 Unprocessable Entity  # Validation error (semantically correct, logically wrong)
429 Too Many Requests     # Rate limited

# Server error codes:
500 Internal Server Error # Unexpected server failure
502 Bad Gateway           # Upstream service failed
503 Service Unavailable   # Server overloaded or in maintenance
504 Gateway Timeout       # Upstream service timed out
```

### Request and Response Headers

```
# Request headers
Content-Type: application/json
Accept: application/json
Authorization: Bearer <token>
Idempotency-Key: unique-uuid-here     # for safe retries
If-None-Match: "etag-value"           # conditional GET (304 if unchanged)
If-Match: "etag-value"                # conditional PUT (409 if changed)

# Response headers
Content-Type: application/json
Location: /users/123                  # after 201 Created
ETag: "abc123"                        # resource version for caching
Cache-Control: max-age=3600, public   # caching directives
X-Request-Id: uuid                    # for tracing
Retry-After: 60                       # with 429 or 503
Link: <url>; rel="next"              # pagination links
```

## Error Formats

### Standard Error Response

```json
// RFC 7807 Problem Details (recommended standard)
{
  "type": "https://api.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains invalid fields.",
  "instance": "/users/123",
  "errors": [
    {
      "field": "email",
      "message": "Must be a valid email address",
      "code": "INVALID_FORMAT"
    },
    {
      "field": "age",
      "message": "Must be between 0 and 150",
      "code": "OUT_OF_RANGE",
      "meta": { "min": 0, "max": 150 }
    }
  ],
  "request_id": "req_abc123"
}
```

### Error Handling Implementation

```javascript
// Express.js error handling middleware
class AppError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      type: `https://api.example.com/errors/${this.code}`,
      title: this.message,
      status: this.status,
      ...this.details,
    };
  }
}

// Predefined errors
const Errors = {
  notFound: (resource) =>
    new AppError(404, 'not-found', `${resource} not found`),
  validationFailed: (errors) =>
    new AppError(422, 'validation-error', 'Validation failed', { errors }),
  unauthorized: () =>
    new AppError(401, 'unauthorized', 'Authentication required'),
  forbidden: () =>
    new AppError(403, 'forbidden', 'Insufficient permissions'),
  conflict: (msg) =>
    new AppError(409, 'conflict', msg),
  rateLimited: (retryAfter) =>
    new AppError(429, 'rate-limited', 'Too many requests', { retryAfter }),
};

// Error middleware
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      ...err.toJSON(),
      request_id: req.id,
      instance: req.originalUrl,
    });
  }
  // Unexpected errors: log details, return generic message
  console.error('Unhandled error:', err);
  res.status(500).json({
    type: 'https://api.example.com/errors/internal-error',
    title: 'Internal Server Error',
    status: 500,
    request_id: req.id,
  });
});

// Usage in routes
app.get('/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id);
  if (!user) throw Errors.notFound('User');
  res.json(user);
});
```

```python
# FastAPI error handling
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

class ErrorResponse(BaseModel):
    type: str
    title: str
    status: int
    detail: str | None = None
    errors: list[dict] | None = None

class AppException(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str = None, errors: list = None):
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.errors = errors

app = FastAPI()

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status,
        content={
            "type": f"https://api.example.com/errors/{exc.code}",
            "title": exc.title,
            "status": exc.status,
            "detail": exc.detail,
            "errors": exc.errors,
            "instance": str(request.url),
        },
    )

# Usage
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    user = await db.users.get(user_id)
    if not user:
        raise AppException(404, "not-found", "User not found")
    return user
```

## Pagination

### Cursor-Based Pagination (Recommended)

```json
// Request
// GET /orders?limit=20&cursor=eyJpZCI6MTIzfQ==

// Response
{
  "data": [...],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJpZCI6MTQzfQ==",
    "prev_cursor": "eyJpZCI6MTI0fQ=="
  }
}
```

```javascript
// Implementation
app.get('/orders', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const cursor = req.query.cursor
    ? JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString())
    : null;

  const where = cursor
    ? { id: { [cursor.direction === 'prev' ? 'gt' : 'lt']: cursor.id } }
    : {};

  const orders = await db.orders.findMany({
    where,
    orderBy: { id: 'desc' },
    take: limit + 1, // fetch one extra to check if there's more
  });

  const hasMore = orders.length > limit;
  if (hasMore) orders.pop();

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  res.json({
    data: orders,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? encode({ id: orders[orders.length - 1].id }) : null,
      prev_cursor: cursor ? encode({ id: orders[0].id, direction: 'prev' }) : null,
    },
  });
});
```

### Offset-Based Pagination

```json
// Request
// GET /users?page=3&per_page=20

// Response
{
  "data": [...],
  "pagination": {
    "page": 3,
    "per_page": 20,
    "total_count": 1234,
    "total_pages": 62
  }
}
```

```javascript
// Implementation (simpler but slow for deep pages)
app.get('/users', async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const perPage = Math.min(parseInt(req.query.per_page) || 20, 100);
  const offset = (page - 1) * perPage;

  const [users, totalCount] = await Promise.all([
    db.users.findMany({ skip: offset, take: perPage, orderBy: { id: 'asc' } }),
    db.users.count(),
  ]);

  res.json({
    data: users,
    pagination: {
      page,
      per_page: perPage,
      total_count: totalCount,
      total_pages: Math.ceil(totalCount / perPage),
    },
  });
});
```

### Link Header Pagination (GitHub style)

```
Link: <https://api.example.com/users?page=2&per_page=20>; rel="next",
      <https://api.example.com/users?page=62&per_page=20>; rel="last",
      <https://api.example.com/users?page=1&per_page=20>; rel="first"
```

## Versioning

### URL Path Versioning (Most Common)

```
GET /v1/users
GET /v2/users

# Implementation: route prefix
app.use('/v1', v1Router);
app.use('/v2', v2Router);
```

### Header Versioning

```
# Custom header
GET /users
Accept-Version: 2

# Content type
GET /users
Accept: application/vnd.myapi.v2+json
```

### Versioning Strategy

```javascript
// Middleware approach
function apiVersion(req, res, next) {
  // Check URL, header, or query param
  const version = req.params.version       // /v2/users
    || req.headers['accept-version']        // Accept-Version: 2
    || req.query.api_version                // ?api_version=2
    || '1';                                 // default
  req.apiVersion = parseInt(version);
  next();
}

// Version-specific response
app.get('/users/:id', apiVersion, async (req, res) => {
  const user = await db.users.findById(req.params.id);
  if (req.apiVersion >= 2) {
    res.json({
      id: user.id,
      full_name: user.name,   // renamed field in v2
      email_address: user.email,
    });
  } else {
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  }
});
```

### Deprecation Headers

```javascript
// Signal deprecation in response headers
res.set('Deprecation', 'true');
res.set('Sunset', 'Sat, 01 Mar 2025 00:00:00 GMT');
res.set('Link', '<https://api.example.com/v2/users>; rel="successor-version"');
```

## Authentication Patterns

### JWT (JSON Web Tokens)

```javascript
import jwt from 'jsonwebtoken';

// Token creation
function createTokens(user) {
  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m', issuer: 'myapp', audience: 'myapp-api' }
  );
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

// Token verification middleware
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, {
      issuer: 'myapp',
      audience: 'myapp-api',
    });
    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Refresh endpoint
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    // Check if refresh token is revoked (stored in DB/Redis)
    const isRevoked = await redis.get(`revoked:${refreshToken}`);
    if (isRevoked) return res.status(401).json({ error: 'Token revoked' });

    const user = await db.users.findById(payload.sub);
    const tokens = createTokens(user);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout: revoke refresh token
app.post('/auth/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  await redis.set(`revoked:${refreshToken}`, '1', 'EX', 7 * 24 * 3600);
  res.status(204).send();
});
```

### OAuth2 Flows

```
# Authorization Code Flow (server-side apps)
# Step 1: Redirect user to authorization server
GET https://auth.example.com/authorize?
    response_type=code&
    client_id=CLIENT_ID&
    redirect_uri=https://myapp.com/callback&
    scope=read+write&
    state=random_csrf_token&
    code_challenge=BASE64URL(SHA256(code_verifier))&
    code_challenge_method=S256

# Step 2: User grants access, redirected back with code
GET https://myapp.com/callback?code=AUTH_CODE&state=random_csrf_token

# Step 3: Exchange code for tokens (server-to-server)
POST https://auth.example.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code=AUTH_CODE&
redirect_uri=https://myapp.com/callback&
client_id=CLIENT_ID&
client_secret=CLIENT_SECRET&
code_verifier=ORIGINAL_VERIFIER

# Response:
{
  "access_token": "eyJhbG...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "dGhpcyBp...",
  "scope": "read write"
}
```

```
# Client Credentials Flow (machine-to-machine)
POST https://auth.example.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&
client_id=CLIENT_ID&
client_secret=CLIENT_SECRET&
scope=api.read
```

### API Key Authentication

```javascript
// API key validation middleware
async function apiKeyAuth(req, res, next) {
  // Check multiple locations
  const apiKey = req.headers['x-api-key']
    || req.query.api_key
    || req.headers.authorization?.replace('ApiKey ', '');

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  // Hash the key before lookup (store hashed keys in DB)
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const keyRecord = await db.apiKeys.findOne({ hash: keyHash, active: true });

  if (!keyRecord) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // Check rate limits, permissions
  req.apiKey = keyRecord;
  req.user = { id: keyRecord.userId, permissions: keyRecord.permissions };

  // Track usage
  await db.apiKeys.updateOne({ id: keyRecord.id }, { $inc: { requestCount: 1 }, lastUsedAt: new Date() });

  next();
}

// Key generation
function generateApiKey() {
  const prefix = 'myapp';
  const key = crypto.randomBytes(32).toString('base64url');
  return `${prefix}_${key}`;  // e.g., myapp_a1b2c3d4e5...
}
```

## Rate Limiting

### Token Bucket / Sliding Window

```javascript
// Redis-based sliding window rate limiter
const redis = require('ioredis');
const client = new redis();

async function rateLimit(req, res, next) {
  const key = `rate:${req.ip}`;   // or req.user.id for authenticated
  const limit = 100;               // requests
  const window = 60;               // seconds

  const multi = client.multi();
  const now = Date.now();
  const windowStart = now - window * 1000;

  multi.zremrangebyscore(key, 0, windowStart); // remove old entries
  multi.zadd(key, now, `${now}:${Math.random()}`); // add current request
  multi.zcard(key);                              // count in window
  multi.expire(key, window);                     // cleanup

  const results = await multi.exec();
  const count = results[2][1];

  // Set rate limit headers
  res.set({
    'X-RateLimit-Limit': limit,
    'X-RateLimit-Remaining': Math.max(0, limit - count),
    'X-RateLimit-Reset': Math.ceil((now + window * 1000) / 1000),
  });

  if (count > limit) {
    res.set('Retry-After', window);
    return res.status(429).json({
      type: 'https://api.example.com/errors/rate-limited',
      title: 'Too Many Requests',
      status: 429,
      detail: `Rate limit of ${limit} requests per ${window}s exceeded`,
      retryAfter: window,
    });
  }

  next();
}
```

### Tiered Rate Limits

```javascript
const RATE_LIMITS = {
  free:       { rpm: 60,   rpd: 1000  },
  basic:      { rpm: 300,  rpd: 10000 },
  pro:        { rpm: 1000, rpd: 100000 },
  enterprise: { rpm: 5000, rpd: 500000 },
};

function getRateLimit(req) {
  const plan = req.user?.plan || 'free';
  return RATE_LIMITS[plan];
}

// Per-endpoint rate limits
app.post('/ai/generate', rateLimit({ rpm: 10 }), handler);
app.get('/users', rateLimit({ rpm: 100 }), handler);
```

## CORS

### CORS Configuration

```javascript
// Express.js CORS setup
const cors = require('cors');

// Simple: allow specific origin
app.use(cors({
  origin: 'https://myapp.com',
}));

// Multiple origins with credentials
app.use(cors({
  origin: ['https://myapp.com', 'https://staging.myapp.com'],
  credentials: true,  // allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-RateLimit-Remaining', 'X-Request-Id'],
  maxAge: 86400,  // preflight cache (seconds)
}));

// Dynamic origin validation
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowed = [
      /^https:\/\/.*\.myapp\.com$/,
      /^http:\/\/localhost:\d+$/,
    ];

    if (allowed.some(pattern => pattern.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
}));
```

```python
# FastAPI CORS
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://myapp.com", "https://staging.myapp.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Remaining"],
    max_age=86400,
)
```

### CORS Debugging

```
# Preflight request (browser sends this automatically for "non-simple" requests)
OPTIONS /api/users HTTP/1.1
Host: api.example.com
Origin: https://myapp.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: Content-Type, Authorization

# Expected response
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://myapp.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400

# Common CORS mistakes:
# 1. Wildcard (*) with credentials: not allowed by browsers
# 2. Missing allowed headers: browser blocks request
# 3. Missing exposed headers: JS can't read custom response headers
# 4. Preflight not handled: 404/405 on OPTIONS request
```

## OpenAPI / Swagger

### OpenAPI 3.1 Specification

```yaml
openapi: 3.1.0
info:
  title: My API
  version: 1.0.0
  description: API for managing users and orders
  contact:
    email: api@example.com

servers:
  - url: https://api.example.com/v1
    description: Production
  - url: https://staging-api.example.com/v1
    description: Staging

security:
  - bearerAuth: []

paths:
  /users:
    get:
      summary: List users
      operationId: listUsers
      tags: [Users]
      parameters:
        - name: page
          in: query
          schema:
            type: integer
            minimum: 1
            default: 1
        - name: per_page
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 100
            default: 20
        - name: status
          in: query
          schema:
            type: string
            enum: [active, inactive, suspended]
      responses:
        '200':
          description: Paginated list of users
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/User'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '401':
          $ref: '#/components/responses/Unauthorized'

    post:
      summary: Create user
      operationId: createUser
      tags: [Users]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateUserRequest'
      responses:
        '201':
          description: User created
          headers:
            Location:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '422':
          $ref: '#/components/responses/ValidationError'

components:
  schemas:
    User:
      type: object
      required: [id, email, name, created_at]
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
        status:
          type: string
          enum: [active, inactive, suspended]
        created_at:
          type: string
          format: date-time

    CreateUserRequest:
      type: object
      required: [email, name]
      properties:
        email:
          type: string
          format: email
        name:
          type: string
          minLength: 1
          maxLength: 100
        role:
          type: string
          enum: [user, admin]
          default: user

    Pagination:
      type: object
      properties:
        page:
          type: integer
        per_page:
          type: integer
        total_count:
          type: integer
        total_pages:
          type: integer

    Error:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        errors:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string
              code:
                type: string

  responses:
    Unauthorized:
      description: Authentication required
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

    ValidationError:
      description: Validation error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
```

## Webhooks

### Webhook Provider Implementation

```javascript
// Webhook dispatch with retry and signing
const crypto = require('crypto');

async function dispatchWebhook(subscription, event) {
  const payload = JSON.stringify({
    id: crypto.randomUUID(),
    type: event.type,
    created_at: new Date().toISOString(),
    data: event.data,
  });

  // Sign the payload
  const signature = crypto
    .createHmac('sha256', subscription.secret)
    .update(payload)
    .digest('hex');

  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signatureV2 = crypto
    .createHmac('sha256', subscription.secret)
    .update(signedPayload)
    .digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Webhook-Id': event.id,
    'X-Webhook-Timestamp': timestamp.toString(),
    'X-Webhook-Signature': `v1=${signature}`,
    'X-Webhook-Signature-V2': `t=${timestamp},v1=${signatureV2}`,
    'User-Agent': 'MyApp-Webhook/1.0',
  };

  // Retry with exponential backoff
  const maxRetries = 5;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        await logDelivery(subscription, event, 'success', response.status);
        return;
      }

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        await logDelivery(subscription, event, 'failed', response.status);
        return; // Don't retry client errors (except 429)
      }
    } catch (err) {
      // Network error or timeout — retry
    }

    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 60000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  await logDelivery(subscription, event, 'exhausted');
  await disableSubscriptionIfFailing(subscription);
}
```

### Webhook Consumer Implementation

```javascript
// Verify and process incoming webhooks
app.post('/webhooks/myapp', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];

  // Verify timestamp (prevent replay attacks: reject if > 5 min old)
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) {
    return res.status(400).json({ error: 'Timestamp too old' });
  }

  // Verify signature
  const expected = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(`v1=${expected}`),
    Buffer.from(signature)
  )) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Respond immediately (process async)
  res.status(200).json({ received: true });

  // Process event asynchronously
  const event = JSON.parse(req.body);
  processWebhookEvent(event).catch(console.error);
});

async function processWebhookEvent(event) {
  // Idempotency: check if already processed
  const processed = await redis.get(`webhook:${event.id}`);
  if (processed) return;

  switch (event.type) {
    case 'payment.completed':
      await handlePaymentCompleted(event.data);
      break;
    case 'user.created':
      await handleUserCreated(event.data);
      break;
  }

  // Mark as processed (expire after 7 days)
  await redis.set(`webhook:${event.id}`, '1', 'EX', 604800);
}
```

## Idempotency

### Idempotency Key Pattern

```javascript
// Middleware for idempotent POST requests
async function idempotency(req, res, next) {
  if (req.method !== 'POST') return next();

  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return next(); // optional; or require it

  const cacheKey = `idempotency:${req.user.id}:${idempotencyKey}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    const { status, body } = JSON.parse(cached);
    res.set('X-Idempotency-Replayed', 'true');
    return res.status(status).json(body);
  }

  // Intercept response to cache it
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    redis.set(cacheKey, JSON.stringify({ status: res.statusCode, body }), 'EX', 86400);
    return originalJson(body);
  };

  next();
}

app.use('/v1', idempotency);
```

## Filtering, Sorting, and Field Selection

### Query Parameter Conventions

```
# Filtering
GET /products?category=electronics&price_min=10&price_max=100
GET /products?status=active,pending        # multiple values
GET /products?created_after=2024-01-01
GET /products?search=wireless+keyboard     # text search

# Sorting
GET /products?sort=price               # ascending
GET /products?sort=-price              # descending (prefix -)
GET /products?sort=-created_at,name    # multiple fields

# Field selection (sparse fieldsets)
GET /users?fields=id,name,email
GET /users/123?fields=id,name,orders.id,orders.total

# Embedding related resources
GET /users/123?include=orders,profile
GET /users/123?expand=orders

# Combined
GET /products?category=electronics&sort=-price&fields=id,name,price&page=1&per_page=20
```

```javascript
// Implementation: query builder from params
function buildQuery(req) {
  const {
    sort = '-created_at',
    fields,
    page = 1,
    per_page = 20,
    ...filters
  } = req.query;

  // Build filter conditions
  const where = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key.endsWith('_min')) {
      where[key.replace('_min', '')] = { ...where[key.replace('_min', '')], gte: parseFloat(value) };
    } else if (key.endsWith('_max')) {
      where[key.replace('_max', '')] = { ...where[key.replace('_max', '')], lte: parseFloat(value) };
    } else if (value.includes(',')) {
      where[key] = { in: value.split(',') };
    } else {
      where[key] = value;
    }
  }

  // Build sort
  const orderBy = sort.split(',').map(field => ({
    [field.replace('-', '')]: field.startsWith('-') ? 'desc' : 'asc',
  }));

  // Build field selection
  const select = fields
    ? Object.fromEntries(fields.split(',').map(f => [f.trim(), true]))
    : undefined;

  return { where, orderBy, select, skip: (page - 1) * per_page, take: parseInt(per_page) };
}
```

## API Security Best Practices

### Input Validation

```javascript
// Zod schema validation
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).trim(),
  age: z.number().int().min(0).max(150).optional(),
  role: z.enum(['user', 'admin']).default('user'),
  metadata: z.record(z.string()).optional(),
}).strict(); // reject unknown fields

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        type: 'https://api.example.com/errors/validation-error',
        title: 'Validation Error',
        status: 422,
        errors: result.error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }
    req.body = result.data; // use parsed/sanitized data
    next();
  };
}

app.post('/users', validate(CreateUserSchema), createUser);
```

### Security Headers

```javascript
// Essential security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Request-Id': req.id || crypto.randomUUID(),
    'Cache-Control': 'no-store',  // for API responses with sensitive data
  });
  next();
});

// Remove fingerprinting headers
app.disable('x-powered-by');

// Request size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
```

## Common Pitfalls

### API Design Anti-Patterns

```
# 1. Verbs in URLs
BAD:  GET /getUser/123, POST /createUser
GOOD: GET /users/123,   POST /users

# 2. Inconsistent naming
BAD:  /users, /order-items, /ProductCategories
GOOD: /users, /order-items, /product-categories (pick one convention)

# 3. Returning different shapes for same resource
BAD:  GET /users returns {name: "..."}, GET /users/123 returns {user_name: "..."}
GOOD: Same field names everywhere

# 4. Using 200 for errors
BAD:  200 { "error": true, "message": "Not found" }
GOOD: 404 { "type": "...", "title": "Not Found", "status": 404 }

# 5. Exposing internal IDs/details
BAD:  { "error": "psycopg2.OperationalError: connection refused" }
GOOD: { "error": "Service temporarily unavailable" }
# Log the real error server-side

# 6. No rate limiting
# Always implement rate limiting, even for internal APIs

# 7. Accepting unbounded queries
BAD:  GET /users (returns all 10M users)
GOOD: GET /users?per_page=20 (always paginate, enforce max per_page)

# 8. Breaking changes without versioning
# Adding a field: usually safe (additive change)
# Removing/renaming a field: BREAKING — needs new version
# Changing field type: BREAKING
# Changing response status code: BREAKING
```
