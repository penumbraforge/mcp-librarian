---
name: docker
description: "Dockerfile best practices, multi-stage builds, Compose, health checks, debugging containers, security hardening, BuildKit, slim bases, networking, volumes, and production patterns."
domain: devops
version: "1.0"
---

# Docker Reference Dictionary

## Dockerfile Best Practices

### Minimal Base Images

```dockerfile
# AVOID: Full OS image (1GB+)
FROM ubuntu:22.04

# BETTER: Slim variant (~80MB)
FROM python:3.12-slim

# BEST: Alpine (~5MB) or distroless
FROM node:20-alpine
FROM gcr.io/distroless/nodejs20-debian12

# Wolfi / Chainguard (zero CVE base)
FROM cgr.dev/chainguard/python:latest

# Pin image digests for reproducibility in production
FROM node:20-alpine@sha256:abc123def456...
```

### Layer Optimization

```dockerfile
# BAD: Each RUN creates a layer, caching broken by early changes
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git
RUN rm -rf /var/lib/apt/lists/*

# GOOD: Combine commands, clean up in same layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Order layers from least to most frequently changed:
# 1. Base image (rarely changes)
# 2. System dependencies (rarely changes)
# 3. App dependencies (changes sometimes)
# 4. Application code (changes often)

# Example: Node.js with proper layer ordering
FROM node:20-alpine

WORKDIR /app

# Copy only dependency files first (cached if unchanged)
COPY package.json package-lock.json ./
RUN npm ci --production

# Then copy application code (this layer changes most)
COPY . .

CMD ["node", "server.js"]
```

### Build Arguments and Environment

```dockerfile
# Build-time variables
ARG NODE_ENV=production
ARG APP_VERSION=unknown

# Runtime environment
ENV NODE_ENV=${NODE_ENV}
ENV APP_VERSION=${APP_VERSION}

# Don't put secrets in ARG/ENV (visible in image history)
# BAD:
ARG DATABASE_URL=postgres://user:pass@host/db

# GOOD: Use BuildKit secrets
RUN --mount=type=secret,id=db_url \
    export DATABASE_URL=$(cat /run/secrets/db_url) && \
    python manage.py collectstatic

# Pass at build time:
# docker build --secret id=db_url,src=.env.db .
```

### COPY vs ADD

```dockerfile
# COPY: Simple file/directory copy (preferred)
COPY src/ /app/src/
COPY package.json /app/

# ADD: Extra features (usually unnecessary)
# - Can extract tar archives
# - Can fetch URLs (but curl is better)
ADD archive.tar.gz /app/       # auto-extracts
ADD https://example.com/f /app/ # don't do this

# Always prefer COPY unless you need tar extraction
# Use curl/wget for URL downloads (better caching, error handling)
RUN curl -fsSL https://example.com/file -o /app/file
```

### User and Permissions

```dockerfile
# Never run as root in production
FROM node:20-alpine

# Create non-root user
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

WORKDIR /app
COPY --chown=appuser:appgroup . .

USER appuser

CMD ["node", "server.js"]

# If you need root for setup, switch back after
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev && rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app
WORKDIR /app
COPY --chown=app:app . .

RUN pip install --no-cache-dir -r requirements.txt

USER app
CMD ["gunicorn", "app:create_app()", "-b", "0.0.0.0:8000"]
```

## Multi-Stage Builds

### Basic Multi-Stage

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production (only build output)
FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### Go Multi-Stage (Static Binary)

```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server ./cmd/server

# Production: scratch or distroless (minimal attack surface)
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/server /server
USER 65534:65534
ENTRYPOINT ["/server"]
```

### Python Multi-Stage

```dockerfile
# Build stage: compile wheels
FROM python:3.12-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# Production stage: install pre-built wheels
FROM python:3.12-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels

RUN groupadd -r app && useradd -r -g app app
WORKDIR /app
COPY . .
USER app
CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:8000", "app:create_app()"]
```

### Rust Multi-Stage

```dockerfile
# Build stage with caching
FROM rust:1.76-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache dependencies: build with empty main first
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src

# Now build the real app (dependencies already cached)
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Production: minimal image
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/myapp /usr/local/bin/
USER 65534:65534
CMD ["myapp"]
```

### Multi-Stage with Test Stage

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS test
COPY . .
RUN npm run lint && npm test

FROM base AS build
COPY . .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package*.json ./
RUN npm ci --production
USER node
CMD ["node", "dist/server.js"]

# Build only test stage: docker build --target test .
# Build production: docker build --target production .
```

## Docker Compose

### Production-Ready Compose

```yaml
# docker-compose.yml
version: "3.9"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
      args:
        NODE_ENV: production
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d myapp"]
      interval: 10s
      timeout: 5s
      retries: 5
    shm_size: 256mb

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  worker:
    build:
      context: .
      target: production
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/myapp
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

volumes:
  postgres_data:
  redis_data:

networks:
  default:
    driver: bridge
```

### Development Compose Override

```yaml
# docker-compose.override.yml (auto-loaded in dev)
version: "3.9"

services:
  api:
    build:
      target: base  # use development stage
    volumes:
      - .:/app
      - /app/node_modules  # don't override node_modules
    environment:
      NODE_ENV: development
      DEBUG: "app:*"
    command: ["npx", "nodemon", "--watch", "src", "src/server.ts"]
    ports:
      - "9229:9229"  # Node.js debugger

  db:
    ports:
      - "5432:5432"  # Expose DB for local tools

  redis:
    ports:
      - "6379:6379"

  mailhog:
    image: mailhog/mailhog
    ports:
      - "1025:1025"  # SMTP
      - "8025:8025"  # Web UI
```

### Compose Commands

```bash
# Start services
docker compose up -d
docker compose up -d --build  # rebuild images

# Scale a service
docker compose up -d --scale worker=4

# View logs
docker compose logs -f api
docker compose logs -f --tail 100

# Execute command in running container
docker compose exec api sh
docker compose exec db psql -U app -d myapp

# Run a one-off command
docker compose run --rm api npm test
docker compose run --rm api npx prisma migrate deploy

# Stop and remove everything
docker compose down
docker compose down -v  # also remove volumes
docker compose down --rmi all  # also remove images

# View service status
docker compose ps
docker compose top

# Pull latest images
docker compose pull

# Config validation
docker compose config
```

## Health Checks

### Dockerfile Health Checks

```dockerfile
# HTTP health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
    CMD curl -f http://localhost:3000/health || exit 1

# TCP health check (no curl needed)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD nc -z localhost 3000 || exit 1

# Custom health check script
COPY healthcheck.sh /usr/local/bin/
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD ["healthcheck.sh"]

# Python health check without curl
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1
```

### Health Check Endpoints

```javascript
// Express.js health check with dependency checks
app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Database check
  try {
    await db.query('SELECT 1');
    checks.database = { status: 'up' };
  } catch (err) {
    checks.database = { status: 'down', error: err.message };
    healthy = false;
  }

  // Redis check
  try {
    await redis.ping();
    checks.redis = { status: 'up' };
  } catch (err) {
    checks.redis = { status: 'down', error: err.message };
    healthy = false;
  }

  // Memory check
  const mem = process.memoryUsage();
  const heapUsedMB = mem.heapUsed / 1024 / 1024;
  checks.memory = {
    status: heapUsedMB < 450 ? 'ok' : 'warning',
    heapUsedMB: Math.round(heapUsedMB),
  };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    uptime: process.uptime(),
    checks,
  });
});

// Liveness vs Readiness (for Kubernetes)
app.get('/healthz', (req, res) => res.sendStatus(200)); // liveness: am I running?
app.get('/readyz', async (req, res) => {                  // readiness: can I serve?
  const dbOk = await checkDatabase();
  res.sendStatus(dbOk ? 200 : 503);
});
```

## Debugging Containers

### Interactive Debugging

```bash
# Enter a running container
docker exec -it container_name sh
docker exec -it container_name bash
docker exec -it container_name /bin/sh

# Run with debug shell (override entrypoint)
docker run -it --entrypoint sh myimage:latest

# Start a stopped container in interactive mode
docker start -ai container_name

# Inspect container details
docker inspect container_name
docker inspect --format='{{.State.Health}}' container_name
docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' container_name

# View container resource usage
docker stats container_name
docker stats --no-stream  # snapshot

# View container processes
docker top container_name

# Copy files from/to container
docker cp container_name:/app/logs/error.log ./
docker cp ./config.json container_name:/app/config.json

# View container filesystem changes
docker diff container_name
```

### Log Debugging

```bash
# View logs
docker logs container_name
docker logs -f container_name           # follow
docker logs --tail 100 container_name   # last 100 lines
docker logs --since 1h container_name   # last hour
docker logs --until 30m container_name  # up to 30 min ago
docker logs -t container_name           # with timestamps

# Log drivers
docker run --log-driver json-file --log-opt max-size=10m myimage
docker run --log-driver syslog --log-opt syslog-address=tcp://loghost:514 myimage
```

### Network Debugging

```bash
# List networks
docker network ls
docker network inspect bridge

# Create a custom network
docker network create --driver bridge mynet

# Connect a container to a network
docker network connect mynet container_name

# DNS debugging within a container
docker exec -it container_name nslookup other_service
docker exec -it container_name ping other_service

# Attach a debug container to a network
docker run -it --rm --network container:target_container \
    nicolaka/netshoot bash
# Inside netshoot:
curl http://localhost:3000/health
tcpdump -i any port 3000
ss -tlnp
```

### Build Debugging

```bash
# Build with progress output
docker build --progress=plain -t myimage .

# Build with no cache (rebuild everything)
docker build --no-cache -t myimage .

# Build up to a specific stage
docker build --target builder -t myimage:debug .

# Show image layer history
docker history myimage:latest
docker history --no-trunc myimage:latest

# Analyze image size
docker image inspect myimage:latest --format='{{.Size}}'

# Use dive for layer analysis
docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock \
    wagoodman/dive:latest myimage:latest
```

## Docker Security

### Security Best Practices

```dockerfile
# 1. Use specific image tags (not :latest)
FROM node:20.11.0-alpine3.19

# 2. Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

# 3. Read-only filesystem
# docker run --read-only --tmpfs /tmp myimage

# 4. No new privileges
# docker run --security-opt=no-new-privileges myimage

# 5. Drop all capabilities, add only needed ones
# docker run --cap-drop ALL --cap-add NET_BIND_SERVICE myimage

# 6. Don't install unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    only-what-you-need && rm -rf /var/lib/apt/lists/*

# 7. Use COPY instead of ADD
COPY app.py /app/

# 8. Scan for vulnerabilities
# docker scout cves myimage:latest
# trivy image myimage:latest
# grype myimage:latest
```

### Secrets Management

```dockerfile
# BuildKit secrets (not stored in image layers)
# syntax=docker/dockerfile:1
FROM python:3.12-slim

RUN --mount=type=secret,id=pip_conf,target=/etc/pip.conf \
    pip install --no-cache-dir -r requirements.txt

# Build with:
# docker build --secret id=pip_conf,src=pip.conf .
```

```yaml
# Compose secrets
services:
  api:
    image: myapi
    secrets:
      - db_password
      - api_key
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
  api_key:
    external: true  # Created via: docker secret create api_key key.txt
```

### Security Scanning

```bash
# Docker Scout (built-in)
docker scout cves myimage:latest
docker scout recommendations myimage:latest

# Trivy
trivy image myimage:latest
trivy image --severity HIGH,CRITICAL myimage:latest
trivy fs .  # scan filesystem

# Grype
grype myimage:latest
grype dir:.  # scan directory

# Hadolint: Dockerfile linting
hadolint Dockerfile
# Common rules:
# DL3008: Pin versions in apt-get install
# DL3018: Pin versions in apk add
# DL3025: Use JSON form of CMD
# DL4006: Set SHELL option -o pipefail
```

## BuildKit

### BuildKit Features

```bash
# Enable BuildKit
export DOCKER_BUILDKIT=1
# Or in /etc/docker/daemon.json: { "features": { "buildkit": true } }

# Build with BuildKit
docker buildx build -t myimage .

# Cache mounts (speed up package installs)
```

```dockerfile
# syntax=docker/dockerfile:1

# Cache apt packages across builds
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends gcc

# Cache pip downloads
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Cache npm modules
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Cache Go modules
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /app ./cmd/server

# Cache Maven/Gradle
RUN --mount=type=cache,target=/root/.m2 \
    mvn package -DskipTests
```

### Multi-Platform Builds

```bash
# Create a multi-platform builder
docker buildx create --name multiplatform --use

# Build for multiple architectures
docker buildx build --platform linux/amd64,linux/arm64 \
    -t myregistry/myimage:latest --push .

# Build for specific platform
docker buildx build --platform linux/arm64 -t myimage:arm64 --load .

# Inspect builder
docker buildx inspect --bootstrap

# List available platforms
docker buildx ls
```

### Remote Cache

```bash
# Export cache to registry
docker buildx build \
    --cache-to type=registry,ref=myregistry/cache:latest,mode=max \
    --cache-from type=registry,ref=myregistry/cache:latest \
    -t myregistry/myimage:latest --push .

# GitHub Actions cache
docker buildx build \
    --cache-from type=gha \
    --cache-to type=gha,mode=max \
    -t myimage:latest .

# Local cache directory
docker buildx build \
    --cache-from type=local,src=/tmp/buildcache \
    --cache-to type=local,dest=/tmp/buildcache,mode=max \
    -t myimage:latest .
```

## Networking

### Network Types

```bash
# Bridge (default): isolated network on host
docker network create --driver bridge myapp-net
docker run --network myapp-net --name api myapi
docker run --network myapp-net --name db postgres
# api can reach db via hostname "db"

# Host: share host's network stack
docker run --network host myapi
# Container uses host's ports directly (no port mapping needed)
# Faster but less isolated

# None: no networking
docker run --network none myapp

# Overlay: multi-host networking (Swarm)
docker network create --driver overlay --attachable myoverlay

# Macvlan: assign MAC address, appear as physical device
docker network create -d macvlan \
    --subnet=192.168.1.0/24 \
    --gateway=192.168.1.1 \
    -o parent=eth0 mymacvlan
```

### DNS and Service Discovery

```yaml
# Compose: services resolve by name automatically
services:
  api:
    networks:
      - frontend
      - backend
  db:
    networks:
      - backend
  nginx:
    networks:
      - frontend

networks:
  frontend:
  backend:

# api can reach db (both on backend) and nginx (both on frontend)
# nginx cannot reach db (different networks)
```

```bash
# Custom DNS
docker run --dns 8.8.8.8 --dns-search example.com myapp

# Add host entries
docker run --add-host myhost:192.168.1.100 myapp

# Alias a container in a network
docker network connect --alias db-primary mynet db_container
```

## Volumes and Storage

### Volume Types

```bash
# Named volume (Docker managed)
docker volume create mydata
docker run -v mydata:/app/data myimage

# Bind mount (host path)
docker run -v /host/path:/container/path myimage
docker run -v $(pwd)/config:/app/config:ro myimage  # read-only

# tmpfs mount (in-memory)
docker run --tmpfs /tmp:rw,noexec,nosuid,size=100m myimage

# Named volume with options
docker volume create --driver local \
    --opt type=nfs \
    --opt o=addr=nfs-server,rw \
    --opt device=:/path/to/dir \
    nfs-data
```

### Volume Management

```bash
# List volumes
docker volume ls
docker volume ls -f dangling=true  # unused volumes

# Inspect volume
docker volume inspect mydata

# Remove unused volumes
docker volume prune
docker volume prune -f  # skip confirmation

# Backup a volume
docker run --rm -v mydata:/source -v $(pwd):/backup \
    alpine tar czf /backup/mydata-backup.tar.gz -C /source .

# Restore a volume
docker run --rm -v mydata:/target -v $(pwd):/backup \
    alpine tar xzf /backup/mydata-backup.tar.gz -C /target
```

## Production Patterns

### Graceful Shutdown

```dockerfile
# Use exec form for CMD (PID 1 receives signals)
CMD ["node", "server.js"]
# NOT: CMD node server.js (runs in /bin/sh, signals not forwarded)

# Use tini as init process for proper signal handling
FROM node:20-alpine
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
```

```javascript
// Handle shutdown signals in Node.js
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(async () => {
    await db.disconnect();
    await redis.quit();
    process.exit(0);
  });
  // Force exit after timeout
  setTimeout(() => process.exit(1), 30000);
});
```

```python
# Handle shutdown in Python
import signal
import sys

def shutdown_handler(signum, frame):
    print("Shutting down gracefully...")
    db.close()
    sys.exit(0)

signal.signal(signal.SIGTERM, shutdown_handler)
signal.signal(signal.SIGINT, shutdown_handler)
```

### Resource Limits

```bash
# Memory limits
docker run --memory=512m --memory-swap=512m myimage  # no swap
docker run --memory=512m --memory-swap=1g myimage     # 512MB swap
docker run --memory=512m --oom-kill-disable myimage   # don't OOM kill

# CPU limits
docker run --cpus=1.5 myimage          # 1.5 CPU cores
docker run --cpu-shares=512 myimage    # relative weight (default 1024)
docker run --cpuset-cpus="0,1" myimage # pin to specific CPUs

# I/O limits
docker run --device-read-bps /dev/sda:10mb myimage
docker run --device-write-bps /dev/sda:10mb myimage

# PID limit
docker run --pids-limit 100 myimage
```

### Image Optimization

```bash
# Check image size
docker images myimage
docker system df

# Remove dangling images and containers
docker system prune
docker system prune -a  # also unused images
docker system prune -a --volumes  # nuclear option

# Squash layers (experimental)
docker build --squash -t myimage .

# Export/import (single layer)
docker export container_name | docker import - myimage:flat

# .dockerignore (reduce build context)
cat > .dockerignore << 'EOF'
.git
node_modules
dist
coverage
*.md
.env*
.vscode
.idea
docker-compose*.yml
Dockerfile*
EOF
```

### Container Orchestration Readiness

```yaml
# Kubernetes-ready Compose (kompose compatible)
services:
  api:
    image: myregistry/myapi:1.0.0
    ports:
      - "3000:3000"
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      rollback_config:
        parallelism: 1
        delay: 5s
      restart_policy:
        condition: on-failure
        max_attempts: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
```

## Common Pitfalls

### Debugging Common Issues

```bash
# "No space left on device"
docker system prune -a --volumes
docker system df -v  # see what's using space

# Container exits immediately
docker logs container_name
docker run -it myimage sh  # debug interactively

# "port is already allocated"
docker ps -a  # find conflicting container
lsof -i :3000  # check what's using the port

# DNS resolution failures inside container
docker exec container_name cat /etc/resolv.conf
docker run --dns 8.8.8.8 myimage  # use external DNS

# Permission denied on mounted volume
# Host UID doesn't match container UID
docker run -u $(id -u):$(id -g) -v $(pwd):/app myimage
# Or fix in Dockerfile: RUN chown -R app:app /app

# Slow builds
# Enable BuildKit: DOCKER_BUILDKIT=1
# Use .dockerignore
# Order Dockerfile layers properly
# Use cache mounts
# Check build context size: du -sh . before build

# Container can't connect to host service
# macOS/Windows: use host.docker.internal
# Linux: use --network host or --add-host host.docker.internal:host-gateway
docker run --add-host host.docker.internal:host-gateway myimage
```

### Docker Compose Pitfalls

```yaml
# Problem: Service starts before dependency is ready
# depends_on only waits for container start, not readiness
# Solution: Use healthcheck conditions
depends_on:
  db:
    condition: service_healthy

# Problem: .env file not loading
# Solution: Explicit env_file
env_file:
  - .env
  - .env.local

# Problem: Named volumes persist old data after rebuild
# Solution: Remove volumes explicitly
# docker compose down -v

# Problem: Build cache stale after changing Dockerfile
# Solution: Force rebuild
# docker compose build --no-cache
# docker compose up -d --build --force-recreate
```
