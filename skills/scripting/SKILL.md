---
name: scripting
description: "Advanced scripting dictionary for Python, JavaScript/TypeScript, Bash, and Go. Load for any scripting or automation task."
domain: scripting
version: "1.0"
---

# Scripting Reference Dictionary

## Python

### Async Patterns
```python
import asyncio, aiohttp

async def fetch_all(urls):
    async with aiohttp.ClientSession() as s:
        return await asyncio.gather(*[fetch(s, u) for u in urls], return_exceptions=True)

async def fetch(session, url):
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
        return {'url': url, 'status': r.status, 'body': await r.text()}

# Rate-limited
sem = asyncio.Semaphore(10)
async def limited(coro):
    async with sem: return await coro

# Async generator
async def stream_lines(path):
    async with aiofiles.open(path) as f:
        async for line in f: yield line.strip()
```

### CLI Frameworks
```python
# argparse
p = argparse.ArgumentParser(description='Tool')
p.add_argument('target')
p.add_argument('-p', '--port', type=int, default=80)
p.add_argument('-o', '--output', type=argparse.FileType('w'), default='-')
p.add_argument('-v', '--verbose', action='count', default=0)
p.add_argument('--format', choices=['json', 'csv', 'table'], default='json')

# typer (type-hint)
import typer
app = typer.Typer()
@app.command()
def scan(target: str, port: int = 80, verbose: bool = False): pass
```

### Networking
```python
import socket, ssl, struct

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
```

### File Processing
```python
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
```

### Cryptography
```python
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

### Modern Patterns
```typescript
// Typed fetch
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as T;
}

// Retry with backoff
async function retry<T>(fn: () => Promise<T>, attempts = 3, delay = 1000): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { if (i === attempts - 1) throw e; await new Promise(r => setTimeout(r, delay * 2 ** i)); }
  }
  throw new Error('unreachable');
}

// Debounce
function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// AbortController
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 5000);
await fetch(url, { signal: ctrl.signal });
```

### Workers & Streams
```typescript
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
if (isMainThread) {
  const w = new Worker(new URL(import.meta.url), { workerData: { task: 'process' } });
  w.on('message', console.log);
} else {
  parentPort!.postMessage(heavyWork(workerData));
}

// Async iterator pagination
async function* paginate(url: string) {
  let page = 1, hasMore = true;
  while (hasMore) {
    const data = await api(`${url}?page=${page++}`);
    yield data.items; hasMore = data.hasMore;
  }
}
```

## Bash

### Production Template
```bash
#!/usr/bin/env bash
set -euo pipefail; IFS=$'\n\t'

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }

tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

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
```

## Go

### HTTP Server + Graceful Shutdown
```go
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
```

### Worker Pool
```go
func workerPool(jobs <-chan Job, results chan<- Result, n int) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for j := range jobs { results <- process(j) } }()
    }
    wg.Wait(); close(results)
}
```
