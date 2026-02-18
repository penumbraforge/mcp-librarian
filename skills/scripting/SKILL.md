---
name: scripting
description: "Comprehensive scripting and programming reference for Python, JavaScript/TypeScript, Bash, Go, Rust, SQL, testing, databases, and error handling. Load for any coding, automation, or systems task."
domain: scripting
version: "2.0"
---

# Scripting Reference Dictionary

## Python

```python
import asyncio, aiohttp

# --- Async Patterns ---
async def fetch_all(urls):
    async with aiohttp.ClientSession() as s:
        return await asyncio.gather(*[fetch(s, u) for u in urls], return_exceptions=True)

async def fetch(session, url):
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
        return {'url': url, 'status': r.status, 'body': await r.text()}

sem = asyncio.Semaphore(10)
async def limited(coro):
    async with sem: return await coro

async def stream_lines(path):
    async with aiofiles.open(path) as f:
        async for line in f: yield line.strip()

# --- CLI Frameworks ---
import argparse
p = argparse.ArgumentParser(description='Tool')
p.add_argument('target')
p.add_argument('-p', '--port', type=int, default=80)
p.add_argument('-o', '--output', type=argparse.FileType('w'), default='-')
p.add_argument('-v', '--verbose', action='count', default=0)
p.add_argument('--format', choices=['json', 'csv', 'table'], default='json')

import typer
app = typer.Typer()
@app.command()
def scan(target: str, port: int = 80, verbose: bool = False): pass

# --- Dataclasses & Typing ---
from dataclasses import dataclass, field, asdict
from typing import Protocol, TypeVar, Generic, Literal

@dataclass(frozen=True, slots=True)
class Config:
    host: str = "localhost"
    port: int = 8080
    tags: list[str] = field(default_factory=list)
    mode: Literal["dev", "prod"] = "dev"

    def to_dict(self): return asdict(self)

T = TypeVar("T")
class Repository(Protocol[T]):
    def get(self, id: str) -> T | None: ...
    def save(self, item: T) -> None: ...

# Type guards
from typing import TypeGuard
def is_str_list(val: list[object]) -> TypeGuard[list[str]]:
    return all(isinstance(x, str) for x in val)

# --- Context Managers ---
from contextlib import contextmanager, asynccontextmanager
import time

@contextmanager
def timer(label="elapsed"):
    t0 = time.perf_counter()
    yield
    print(f"{label}: {time.perf_counter() - t0:.3f}s")

@contextmanager
def atomic_write(path):
    """Write to temp file, rename on success, clean up on failure."""
    tmp = f"{path}.tmp"
    try:
        with open(tmp, "w") as f: yield f
        os.replace(tmp, path)
    except:
        os.unlink(tmp) if os.path.exists(tmp) else None
        raise

@asynccontextmanager
async def db_transaction(pool):
    conn = await pool.acquire()
    tx = conn.transaction()
    await tx.start()
    try:
        yield conn
        await tx.commit()
    except:
        await tx.rollback()
        raise
    finally:
        await pool.release(conn)

# --- Networking ---
import socket, ssl

def tcp_connect(host, port, data):
    with socket.create_connection((host, port), timeout=5) as s:
        s.sendall(data); return s.recv(4096)

def tls_info(host, port=443):
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port)) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            return ssock.getpeercert()

async def port_scan(host, ports):
    results = []
    async def check(p):
        try:
            _, w = await asyncio.wait_for(asyncio.open_connection(host, p), 1)
            w.close(); results.append(p)
        except: pass
    await asyncio.gather(*[check(p) for p in ports])
    return sorted(results)

# --- File Processing ---
from pathlib import Path
import json, csv, re

def find_files(root, patterns=['*.py', '*.js'], exclude=['node_modules', '.git']):
    for pat in patterns:
        for f in Path(root).rglob(pat):
            if not any(ex in f.parts for ex in exclude): yield f

def read_jsonl(path):
    with open(path) as f: return [json.loads(l) for l in f if l.strip()]

PATTERNS = {
    'email': r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    'ipv4': r'\b(?:\d{1,3}\.){3}\d{1,3}\b',
    'url': r'https?://[^\s<>"{}|\\^`\[\]]+',
    'jwt': r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',
    'aws_key': r'AKIA[0-9A-Z]{16}',
    'private_key': r'-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----',
}

# --- Cryptography ---
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import os

def aes_encrypt(key, plaintext):
    iv = os.urandom(12)
    enc = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
    ct = enc.update(plaintext) + enc.finalize()
    return iv, ct, enc.tag

def aes_decrypt(key, iv, ct, tag):
    dec = Cipher(algorithms.AES(key), modes.GCM(iv, tag)).decryptor()
    return dec.update(ct) + dec.finalize()
```

## JavaScript / TypeScript

```typescript
// --- Typed Fetch & Retry ---
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as T;
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { if (i === attempts - 1) throw e; await new Promise(r => setTimeout(r, delay * 2 ** i)); }
  }
  throw new Error('unreachable');
}

// --- Debounce & AbortController ---
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5000);
await fetch(url, { signal: ctrl.signal });

// --- Workers & Streams ---
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
if (isMainThread) {
  const w = new Worker(new URL(import.meta.url), { workerData: { task: 'process' } });
  w.on('message', console.log);
} else {
  parentPort!.postMessage(heavyWork(workerData));
}

async function* paginate(url: string) {
  let page = 1, hasMore = true;
  while (hasMore) {
    const data = await api(`${url}?page=${page++}`);
    yield data.items; hasMore = data.hasMore;
  }
}

// --- Zod Validation ---
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
  role: z.enum(['admin', 'user', 'viewer']).default('user'),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
type User = z.infer<typeof UserSchema>;

// Parse with error handling
function parseOrNull<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// Composable schemas
const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const SearchSchema = PaginationSchema.extend({
  q: z.string().optional(),
  sort: z.enum(['name', 'created', 'updated']).default('created'),
});

// --- Map & Set Patterns ---
// Grouped aggregation
function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

// LRU cache with Map (insertion order preserved)
class LRU<K, V> {
  private cache = new Map<K, V>();
  constructor(private max: number) {}
  get(key: K): V | undefined {
    const v = this.cache.get(key);
    if (v !== undefined) { this.cache.delete(key); this.cache.set(key, v); }
    return v;
  }
  set(key: K, val: V) {
    this.cache.delete(key);
    this.cache.set(key, val);
    if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
  }
}

// Set operations
const union = <T>(a: Set<T>, b: Set<T>) => new Set([...a, ...b]);
const intersect = <T>(a: Set<T>, b: Set<T>) => new Set([...a].filter(x => b.has(x)));
const diff = <T>(a: Set<T>, b: Set<T>) => new Set([...a].filter(x => !b.has(x)));
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail; IFS=$'\n\t'

# --- Logging & Cleanup ---
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }

tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

# --- Argument Parsing ---
usage() { echo "Usage: $0 [-v] [-o output] <input>" >&2; exit 1; }
verbose=0; output="/dev/stdout"
while getopts "vo:h" opt; do
  case $opt in v) verbose=1;; o) output="$OPTARG";; *) usage;; esac
done
shift $((OPTIND - 1)); [[ $# -ge 1 ]] || usage

# Lock file
exec 200>"/tmp/${0##*/}.lock"; flock -n 200 || die "Already running"

# Retry
retry() { local n=$1; shift; for ((i=1;i<=n;i++)); do "$@" && return 0; sleep $((i*2)); done; return 1; }

# --- Trap Patterns ---
cleanup() { rm -rf "$tmpdir"; log "Cleaned up"; }
on_error() { local exit_code=$?; log "Error on line $1 (exit $exit_code)"; cleanup; exit "$exit_code"; }
trap cleanup EXIT
trap 'on_error $LINENO' ERR
# Trap SIGINT/SIGTERM for graceful shutdown in long-running scripts
shutdown=false
trap 'shutdown=true; log "Shutting down..."' INT TERM
while ! $shutdown; do work_iteration; sleep 5; done

# --- Array Handling ---
declare -a files=()
while IFS= read -r -d '' f; do files+=("$f"); done < <(find . -name '*.sh' -print0)
# Iterate safely
for f in "${files[@]}"; do echo "Processing: $f"; done
# Array slicing: ${arr[@]:offset:length}
first_three=("${files[@]:0:3}")
# Associative arrays
declare -A counts=()
for word in "${words[@]}"; do ((counts[$word]++)) || true; done

# --- Process Substitution ---
# Diff two command outputs without temp files
diff <(sort file1.txt) <(sort file2.txt)
# Read from multiple streams
paste <(cut -d, -f1 data.csv) <(cut -d, -f3 data.csv)
# Feed command output into a while loop (avoids subshell variable scope issues)
while IFS= read -r line; do
  process "$line"
done < <(some_command)
# Tee to multiple commands
echo "data" | tee >(cmd1) >(cmd2) > /dev/null
```

## Go

```go
// --- HTTP Server + Graceful Shutdown ---
mux := http.NewServeMux()
mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte(`{"status":"ok"}`))
})
srv := &http.Server{Addr: ":8080", Handler: mux}
go func() {
    sig := make(chan os.Signal, 1); signal.Notify(sig, os.Interrupt); <-sig
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second); defer cancel()
    srv.Shutdown(ctx)
}()
log.Fatal(srv.ListenAndServe())

// --- Worker Pool ---
func workerPool(jobs <-chan Job, results chan<- Result, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for j := range jobs { results <- process(j) } }()
    }
    wg.Wait(); close(results)
}

// --- Error Handling Patterns ---
import "errors"
import "fmt"

// Sentinel errors
var (
    ErrNotFound   = errors.New("not found")
    ErrForbidden  = errors.New("forbidden")
)

// Custom error type
type ValidationError struct {
    Field   string
    Message string
}
func (e *ValidationError) Error() string { return fmt.Sprintf("%s: %s", e.Field, e.Message) }

// Wrapping and checking
func getUser(id string) (*User, error) {
    u, err := db.Find(id)
    if err != nil {
        return nil, fmt.Errorf("getUser(%s): %w", id, err) // wrap with %w
    }
    return u, nil
}

// Caller checks wrapped errors
if errors.Is(err, ErrNotFound) { /* handle not found */ }
var ve *ValidationError
if errors.As(err, &ve) { log.Printf("field %s invalid: %s", ve.Field, ve.Message) }

// --- Context Usage ---
func fetchData(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return nil, err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}

// Timeout context
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
data, err := fetchData(ctx, "https://api.example.com/data")

// Context values (use sparingly, prefer explicit params)
type ctxKey string
const requestIDKey ctxKey = "requestID"
ctx = context.WithValue(ctx, requestIDKey, "abc-123")
id := ctx.Value(requestIDKey).(string)

// --- Generics ---
func Map[T, U any](s []T, f func(T) U) []U {
    r := make([]U, len(s))
    for i, v := range s { r[i] = f(v) }
    return r
}

func Filter[T any](s []T, pred func(T) bool) []T {
    var r []T
    for _, v := range s { if pred(v) { r = append(r, v) } }
    return r
}

type Number interface { ~int | ~int64 | ~float64 }
func Sum[T Number](nums []T) T {
    var total T
    for _, n := range nums { total += n }
    return total
}
```

## Testing Frameworks

```python
# --- pytest ---
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# Fixtures with scope and cleanup
@pytest.fixture(scope="module")
def db():
    conn = create_connection()
    yield conn
    conn.close()

@pytest.fixture
def client(db):
    app = create_app(db)
    return app.test_client()

# Parametrize: run one test with many inputs
@pytest.mark.parametrize("input,expected", [
    ("hello", "HELLO"),
    ("world", "WORLD"),
    ("", ""),
    ("123abc", "123ABC"),
])
def test_upper(input, expected):
    assert input.upper() == expected

# Parametrize with IDs for readable output
@pytest.mark.parametrize("status,should_retry", [
    (429, True),
    (500, True),
    (200, False),
    (404, False),
], ids=["rate-limit", "server-error", "ok", "not-found"])
def test_retry_logic(status, should_retry):
    assert needs_retry(status) == should_retry

# Mocking
@patch("myapp.service.requests.get")
def test_fetch(mock_get):
    mock_get.return_value = MagicMock(status_code=200, json=lambda: {"key": "val"})
    result = fetch_data("http://example.com")
    assert result == {"key": "val"}
    mock_get.assert_called_once()

# Async test
@pytest.mark.asyncio
async def test_async_fetch():
    mock_session = AsyncMock()
    mock_session.get.return_value.__aenter__.return_value.json = AsyncMock(return_value={"ok": True})
    result = await fetch(mock_session, "http://x.com")
    assert result["ok"]
```

```typescript
// --- Node.js test runner (node:test) ---
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('UserService', () => {
  let service: UserService;
  before(() => { service = new UserService(mockDb); });
  after(() => { mockDb.close(); });

  it('creates a user', async () => {
    const user = await service.create({ name: 'Alice', email: 'a@b.com' });
    assert.equal(user.name, 'Alice');
    assert.ok(user.id);
  });

  it('throws on duplicate email', async () => {
    await assert.rejects(
      () => service.create({ name: 'Bob', email: 'a@b.com' }),
      { message: /duplicate/ }
    );
  });

  it('mocks external calls', () => {
    const fn = mock.fn(() => 42);
    assert.equal(fn(), 42);
    assert.equal(fn.mock.callCount(), 1);
  });
});
```

```go
// --- Go table-driven tests ---
func TestParseSize(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        want    int64
        wantErr bool
    }{
        {"bytes", "100", 100, false},
        {"kilobytes", "10KB", 10240, false},
        {"megabytes", "5MB", 5242880, false},
        {"invalid", "abc", 0, true},
        {"empty", "", 0, true},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseSize(tt.input)
            if (err != nil) != tt.wantErr {
                t.Fatalf("ParseSize(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("ParseSize(%q) = %d, want %d", tt.input, got, tt.want)
            }
        })
    }
}
```

## Database Patterns

```typescript
// --- node-postgres (pg) ---
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

// Parameterized query (ALWAYS use $1, $2... NEVER interpolate)
const { rows } = await pool.query(
  'SELECT * FROM users WHERE email = $1 AND active = $2',
  [email, true]
);

// Transaction helper
async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Usage
await withTransaction(async (client) => {
  const { rows: [order] } = await client.query(
    'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id', [userId, total]
  );
  for (const item of items) {
    await client.query(
      'INSERT INTO order_items (order_id, product_id, qty) VALUES ($1, $2, $3)',
      [order.id, item.productId, item.qty]
    );
  }
  return order;
});
```

```python
# --- SQLAlchemy async ---
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import select, func

engine = create_async_engine("postgresql+asyncpg://user:pass@localhost/db", pool_size=10)
Session = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase): pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    email: Mapped[str] = mapped_column(unique=True)

async def get_users(name_filter: str | None = None) -> list[User]:
    async with Session() as session:
        stmt = select(User)
        if name_filter:
            stmt = stmt.where(User.name.ilike(f"%{name_filter}%"))
        result = await session.execute(stmt)
        return list(result.scalars().all())
```

```typescript
// --- Prisma patterns ---
// Find with relations, filtering, pagination
const users = await prisma.user.findMany({
  where: { active: true, role: { in: ['admin', 'user'] } },
  include: { posts: { where: { published: true }, take: 5 } },
  orderBy: { createdAt: 'desc' },
  skip: 20, take: 10,
});

// Upsert
await prisma.user.upsert({
  where: { email: 'alice@example.com' },
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice' },
});

// Transaction (interactive)
const [order, payment] = await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { userId, total } });
  const payment = await tx.payment.create({ data: { orderId: order.id, amount: total } });
  await tx.user.update({ where: { id: userId }, data: { balance: { decrement: total } } });
  return [order, payment];
});

// Raw SQL for complex queries
const result = await prisma.$queryRaw`
  SELECT u.name, COUNT(p.id)::int as post_count
  FROM users u LEFT JOIN posts p ON p.author_id = u.id
  WHERE u.created_at > ${since}
  GROUP BY u.id ORDER BY post_count DESC LIMIT ${limit}
`;
```

## Error Handling

```python
# --- Python error handling ---

# Custom exception hierarchy
class AppError(Exception):
    def __init__(self, message: str, code: str = "UNKNOWN"):
        self.code = code
        super().__init__(message)

class NotFoundError(AppError):
    def __init__(self, resource: str, id: str):
        super().__init__(f"{resource} {id} not found", code="NOT_FOUND")

class ValidationError(AppError):
    def __init__(self, field: str, reason: str):
        self.field = field
        super().__init__(f"Validation failed on {field}: {reason}", code="VALIDATION")

# Context manager for error translation
from contextlib import contextmanager

@contextmanager
def handle_db_errors():
    """Translate database errors into app-level errors."""
    try:
        yield
    except IntegrityError as e:
        if "unique" in str(e).lower():
            raise ValidationError("email", "already exists") from e
        raise AppError(f"Database integrity error: {e}", "DB_ERROR") from e
    except OperationalError as e:
        raise AppError(f"Database unavailable: {e}", "DB_UNAVAILABLE") from e

# Usage
with handle_db_errors():
    db.execute("INSERT INTO users ...")

# Suppress specific errors
from contextlib import suppress
with suppress(FileNotFoundError):
    os.unlink(tmp_path)
```

```typescript
// --- TypeScript Result type pattern ---
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> { return { ok: true, value }; }
function Err<E>(error: E): Result<never, E> { return { ok: false, error }; }

// Usage: no try/catch needed, errors are values
async function parseConfig(path: string): Result<Config, string> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    const config = ConfigSchema.safeParse(parsed);
    if (!config.success) return Err(`Invalid config: ${config.error.message}`);
    return Ok(config.data);
  } catch {
    return Err(`Cannot read ${path}`);
  }
}

const result = await parseConfig('./config.json');
if (!result.ok) { console.error(result.error); process.exit(1); }
const config = result.value; // narrowed to Config

// Error boundary class for Express/Koa
class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
    this.name = 'AppError';
  }
  static notFound(msg: string) { return new AppError(404, msg, 'NOT_FOUND'); }
  static badRequest(msg: string) { return new AppError(400, msg, 'BAD_REQUEST'); }
}

// Express error middleware
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
```

```go
// --- Go error handling (covered in Go section above) ---
// See Go section for errors.Is, errors.As, wrapping, and sentinel errors.
// Additional pattern: multi-error collection

type MultiError struct {
    Errors []error
}
func (m *MultiError) Error() string {
    msgs := make([]string, len(m.Errors))
    for i, e := range m.Errors { msgs[i] = e.Error() }
    return strings.Join(msgs, "; ")
}
func (m *MultiError) Add(err error) { if err != nil { m.Errors = append(m.Errors, err) } }
func (m *MultiError) Err() error { if len(m.Errors) == 0 { return nil }; return m }
```

## Rust Essentials

```rust
// --- Ownership & Borrowing ---
fn process(data: &str) -> String {       // borrow: read-only reference
    data.to_uppercase()
}
fn modify(data: &mut Vec<String>) {      // mutable borrow: one at a time
    data.push("new".into());
}
fn consume(data: Vec<String>) -> usize { // move: takes ownership
    data.len()                           // data is dropped when function returns
}
// Rule: one &mut OR any number of & at a time, never both.

// Clone when you need independent copies
let original = vec![1, 2, 3];
let copy = original.clone();

// --- Error Handling: Result, Option, ? ---
use std::fs;
use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

fn load_config(path: &str) -> Result<Config, AppError> {
    let content = fs::read_to_string(path)?;    // ? propagates io::Error -> AppError::Io
    let config: Config = serde_json::from_str(&content)?;  // ? propagates parse error
    Ok(config)
}

// Option chaining
fn get_city(user: &User) -> Option<&str> {
    user.address.as_ref()?.city.as_deref()
}

// Combinators
let port: u16 = std::env::var("PORT")
    .ok()                              // Result -> Option
    .and_then(|s| s.parse().ok())      // parse or None
    .unwrap_or(8080);                  // default

// --- Async with Tokio ---
use tokio;
use reqwest;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::Client::new();

    // Concurrent requests
    let (a, b) = tokio::join!(
        client.get("https://api.example.com/a").send(),
        client.get("https://api.example.com/b").send(),
    );

    // Spawn background task
    let handle = tokio::spawn(async move {
        heavy_computation().await
    });
    let result = handle.await?;

    // Select: race multiple futures
    tokio::select! {
        val = async_operation() => println!("completed: {val:?}"),
        _ = tokio::time::sleep(Duration::from_secs(5)) => println!("timeout"),
    }
    Ok(())
}

// --- CLI with Clap ---
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "mytool", about = "A useful CLI tool")]
struct Cli {
    /// Target host or URL
    target: String,
    /// Port number
    #[arg(short, long, default_value_t = 8080)]
    port: u16,
    /// Increase verbosity (-v, -vv, -vvv)
    #[arg(short, long, action = clap::ArgAction::Count)]
    verbose: u8,
    /// Output format
    #[arg(long, value_enum, default_value_t = Format::Json)]
    format: Format,
}

#[derive(clap::ValueEnum, Clone, Debug)]
enum Format { Json, Csv, Table }

fn main() {
    let cli = Cli::parse();
    println!("Target: {} Port: {}", cli.target, cli.port);
}

// --- Serde JSON ---
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct ApiResponse {
    status: String,
    #[serde(default)]
    data: Vec<Item>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
}

let json_str = serde_json::to_string_pretty(&response)?;
let parsed: ApiResponse = serde_json::from_str(&json_str)?;

// Dynamic JSON with serde_json::Value
let v: serde_json::Value = serde_json::from_str(raw)?;
let name = v["users"][0]["name"].as_str().unwrap_or("unknown");
```

## SQL Reference

```sql
-- === Joins ===
-- INNER: only matching rows
SELECT o.id, u.name FROM orders o INNER JOIN users u ON o.user_id = u.id;
-- LEFT: all from left table + matching right (NULLs if no match)
SELECT u.name, COUNT(o.id) as order_count
FROM users u LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id;

-- === CTEs (Common Table Expressions) ===
WITH monthly AS (
  SELECT date_trunc('month', created_at) AS month,
         SUM(amount) AS total, COUNT(*) AS cnt
  FROM payments WHERE created_at > NOW() - INTERVAL '1 year'
  GROUP BY 1
)
SELECT month, total, cnt,
       total - LAG(total) OVER (ORDER BY month) AS growth
FROM monthly ORDER BY month;

-- Recursive CTE (org chart, tree traversal)
WITH RECURSIVE tree AS (
  SELECT id, name, parent_id, 0 AS depth FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.name, c.parent_id, t.depth + 1
  FROM categories c JOIN tree t ON c.parent_id = t.id
)
SELECT * FROM tree ORDER BY depth, name;

-- === Window Functions ===
SELECT name, department, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank,
  SUM(salary) OVER (PARTITION BY department) AS dept_total,
  salary::numeric / SUM(salary) OVER (PARTITION BY department) * 100 AS pct_of_dept
FROM employees;

-- Running total
SELECT date, amount,
  SUM(amount) OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM transactions;

-- === Upsert (INSERT ON CONFLICT) ===
INSERT INTO kv_store (key, value, updated_at)
VALUES ('config:theme', '"dark"', NOW())
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = EXCLUDED.updated_at;

-- Bulk upsert
INSERT INTO products (sku, name, price) VALUES
  ('A1', 'Widget', 9.99),
  ('B2', 'Gadget', 19.99)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price;

-- === Indexing Patterns ===
-- B-tree (default): equality and range queries
CREATE INDEX idx_users_email ON users (email);
-- Partial index: only index rows matching condition
CREATE INDEX idx_active_users ON users (email) WHERE active = true;
-- Composite index: column order matters (leftmost prefix rule)
CREATE INDEX idx_orders_user_date ON orders (user_id, created_at DESC);
-- Covering index: includes extra columns to avoid table lookups
CREATE INDEX idx_orders_cover ON orders (user_id) INCLUDE (total, status);
-- GIN: for arrays, JSONB, full-text
CREATE INDEX idx_tags ON posts USING GIN (tags);

-- === PostgreSQL: JSONB ===
-- Query nested fields
SELECT data->>'name' AS name, data->'address'->>'city' AS city
FROM profiles WHERE data @> '{"role": "admin"}';

-- Update nested JSONB
UPDATE profiles SET data = jsonb_set(data, '{address,zip}', '"90210"')
WHERE id = 1;

-- Aggregate into JSONB
SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name)) FROM users;

-- === PostgreSQL: Arrays ===
SELECT * FROM posts WHERE tags @> ARRAY['rust', 'async'];  -- contains all
SELECT * FROM posts WHERE tags && ARRAY['go', 'python'];   -- overlaps (any)
SELECT unnest(tags) AS tag, COUNT(*) FROM posts GROUP BY tag ORDER BY count DESC;

-- === PostgreSQL: Full-Text Search ===
-- Add tsvector column and index
ALTER TABLE articles ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;
CREATE INDEX idx_fts ON articles USING GIN (search_vec);

-- Query with ranking
SELECT title, ts_rank(search_vec, query) AS rank
FROM articles, to_tsquery('english', 'rust & async') query
WHERE search_vec @@ query
ORDER BY rank DESC LIMIT 20;
```
