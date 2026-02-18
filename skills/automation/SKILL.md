---
name: automation
description: "Worker automation, job queues, process management, scheduling, monitoring, Docker, CI/CD, Redis, and observability. Load for any BullMQ, cron, PM2, Docker, or infrastructure task."
domain: automation
version: "2.0"
---

# Automation & Worker Reference Dictionary

## BullMQ

### Queue Setup
```typescript
import { Queue, Worker, FlowProducer } from 'bullmq';
import type { Job } from 'bullmq';

// Typed job data
interface TaskData { url: string; retries?: number }
interface TaskResult { status: number; body: string }

const connection = { host: '127.0.0.1', port: 6379 };

const queue = new Queue<TaskData, TaskResult>('tasks', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});

// Add jobs with priority (lower number = higher priority)
await queue.add('process', { url: 'https://example.com' }, { priority: 1 });
await queue.addBulk([
  { name: 'process', data: { url: 'https://a.com' }, opts: { priority: 2 } },
  { name: 'process', data: { url: 'https://b.com' }, opts: { priority: 3 } },
]);

// LIFO processing — jobs added with lifo:true get processed before FIFO jobs
await queue.add('urgent', { url: 'https://urgent.com' }, { lifo: true });

// Repeatable via job scheduler (replaces deprecated repeat option)
await queue.upsertJobScheduler(
  'daily-report',
  { pattern: '0 9 * * *' },
  { name: 'report', data: { url: 'https://reports.internal' } },
);

// Remove a scheduled job
await queue.removeJobScheduler('daily-report');

// Rate limited queue
const limited = new Queue('api-calls', {
  connection,
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec
});

// Delayed job
await queue.add('reminder', { url: 'https://example.com' }, { delay: 60000 });
```

### Worker
```typescript
const worker = new Worker<TaskData, TaskResult>(
  'tasks',
  async (job: Job<TaskData, TaskResult>) => {
    job.log(`Processing ${job.name} #${job.id}`);
    await job.updateProgress(50);
    const result = await doWork(job.data);
    await job.updateProgress(100);
    return result;
  },
  {
    connection,
    concurrency: 5,
    limiter: { max: 1, duration: 500 },
    lockDuration: 30000,
    stalledInterval: 15000,
    maxStalledCount: 2,
    autorun: true,
  },
);

worker.on('completed', (job, result) => console.log(`Done: ${job.id}`));
worker.on('failed', (job, err) => console.error(`Fail: ${job?.id}`, err.message));
worker.on('stalled', (jobId) => console.warn(`Stalled: ${jobId}`));
worker.on('error', (err) => console.error('Worker error:', err));
```

### Queue Events Listener
```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('tasks', { connection });

queueEvents.on('waiting', ({ jobId }) => console.log(`Job ${jobId} waiting`));
queueEvents.on('active', ({ jobId, prev }) => console.log(`Job ${jobId} active (was ${prev})`));
queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed`, returnvalue);
});
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed: ${failedReason}`);
});
queueEvents.on('progress', ({ jobId, data }) => console.log(`Job ${jobId} progress:`, data));
queueEvents.on('stalled', ({ jobId }) => console.warn(`Job ${jobId} stalled`));

// Clean up
await queueEvents.close();
```

### FlowProducer (DAG)
```typescript
const flow = new FlowProducer({ connection });
await flow.add({
  name: 'deploy',
  queueName: 'deploy',
  data: { version: '1.0' },
  children: [
    { name: 'build', queueName: 'build', data: { target: 'prod' },
      children: [
        { name: 'test', queueName: 'test', data: { suite: 'unit' } },
        { name: 'lint', queueName: 'test', data: { suite: 'lint' } },
      ]
    },
  ],
});
```

### Dead Letter Queue
```typescript
const dlq = new Queue('dead-letters', { connection });
const mainWorker = new Worker('tasks', async (job) => {
  try { return await processJob(job.data); }
  catch (err) {
    if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
      await dlq.add('failed-task', {
        originalJob: job.name, data: job.data,
        error: String(err), failedAt: new Date().toISOString(),
      });
    }
    throw err;
  }
}, { connection, concurrency: 3 });
```

### Graceful Shutdown
```typescript
async function shutdown(workers: Worker[], queues: Queue[]) {
  console.log('Shutting down...');
  await Promise.all(workers.map(w => w.close()));
  await Promise.all(queues.map(q => q.close()));
  process.exit(0);
}
const workers = [worker]; const queues = [queue];
process.on('SIGTERM', () => shutdown(workers, queues));
process.on('SIGINT', () => shutdown(workers, queues));
```

## PM2 Process Management

### ecosystem.config.js
```javascript
module.exports = {
  apps: [
    {
      name: 'api',
      script: 'dist/server.js',
      instances: 'max',        // cluster mode, one per CPU
      exec_mode: 'cluster',
      env: { NODE_ENV: 'development', PORT: 3000 },
      env_production: { NODE_ENV: 'production', PORT: 8080 },
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/app/error.log',
      out_file: '/var/log/app/out.log',
      merge_logs: true,
      kill_timeout: 5000,
      listen_timeout: 8000,
      wait_ready: true,
    },
    {
      name: 'worker',
      script: 'dist/worker.js',
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      cron_restart: '0 3 * * *',
    },
  ],
};
```

### PM2 Commands
```bash
pm2 start ecosystem.config.js --env production
pm2 restart api                # hard restart (drops connections)
pm2 reload api                 # zero-downtime reload (cluster mode only)
pm2 stop worker
pm2 delete all
pm2 logs api --lines 200       # tail logs
pm2 monit                      # real-time dashboard
pm2 list                       # show all processes
pm2 save                       # persist process list
pm2 startup                    # generate OS startup script
pm2 flush                      # clear all log files
```

### Graceful Restart with PM2
```typescript
import http from 'node:http';

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
  if (process.send) process.send('ready'); // tell PM2 we're ready
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.close(() => {
    // close DB connections, flush queues
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000); // force kill after timeout
});
```

### pm2-logrotate
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

## Process Management

### Node.js Cluster
```typescript
import cluster from 'node:cluster';
import { cpus } from 'node:os';

if (cluster.isPrimary) {
  const n = Math.min(cpus().length, 4);
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (w, code) => {
    console.log(`Worker ${w.process.pid} died (${code})`);
    if (code !== 0) cluster.fork(); // auto-restart
  });
} else {
  startWorker();
}
```

### worker_threads
```typescript
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

if (isMainThread) {
  function runTask(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), { workerData: data });
      w.on('message', resolve);
      w.on('error', reject);
    });
  }
  const results = await Promise.all(items.map(i => runTask(i)));
} else {
  const result = heavyComputation(workerData);
  parentPort!.postMessage(result);
}
```

### EventEmitter Patterns
```typescript
import { EventEmitter } from 'node:events';

// Typed events (Node 22+)
interface AppEvents {
  'job:start': [jobId: string, data: unknown];
  'job:done': [jobId: string, result: unknown];
  'job:error': [jobId: string, error: Error];
}

class TaskRunner extends EventEmitter<AppEvents> {
  async run(jobId: string, data: unknown) {
    this.emit('job:start', jobId, data);
    try {
      const result = await processJob(data);
      this.emit('job:done', jobId, result);
    } catch (err) {
      this.emit('job:error', jobId, err as Error);
    }
  }
}

const runner = new TaskRunner();
runner.on('job:done', (id, result) => console.log(`${id} done`, result));
runner.on('job:error', (id, err) => console.error(`${id} failed`, err));

// Once listener — auto-removes after first call
runner.once('job:start', (id) => console.log(`First job started: ${id}`));

// AbortSignal integration (Node 20+)
const ac = new AbortController();
runner.on('job:error', (id, err) => console.error(err), { signal: ac.signal });
ac.abort(); // removes the listener
```

### Environment Variable Management
```typescript
// dotenv — load .env file
import 'dotenv/config';

// envalid — validate and type environment variables
import { cleanEnv, str, port, num, bool, url } from 'envalid';

const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'production', 'test'] }),
  PORT: port({ default: 3000 }),
  DATABASE_URL: url(),
  REDIS_URL: url({ default: 'redis://127.0.0.1:6379' }),
  JWT_SECRET: str(),
  LOG_LEVEL: str({ choices: ['debug', 'info', 'warn', 'error'], default: 'info' }),
  WORKER_CONCURRENCY: num({ default: 5 }),
  ENABLE_METRICS: bool({ default: false }),
});

// env is fully typed and validated — exits on missing/invalid vars
export default env;
```

### systemd Service
```ini
[Unit]
Description=Worker Service
After=network.target redis.service postgresql.service
Wants=redis.service

[Service]
Type=notify
User=app
WorkingDirectory=/opt/app
ExecStart=/usr/bin/node dist/worker.js
ExecReload=/bin/kill -USR2 $MAINPID
Restart=on-failure
RestartSec=5
WatchdogSec=30
Environment=NODE_ENV=production
Environment=REDIS_URL=redis://localhost:6379
EnvironmentFile=-/opt/app/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=app-worker
LimitNOFILE=65535
ProtectSystem=strict
ReadWritePaths=/opt/app/data

[Install]
WantedBy=multi-user.target
```

### systemd / journalctl Commands
```bash
systemctl start app-worker
systemctl enable app-worker         # start on boot
systemctl status app-worker
systemctl reload app-worker         # send SIGUSR2 (ExecReload)

journalctl -u app-worker -f         # tail logs
journalctl -u app-worker --since "1 hour ago"
journalctl -u app-worker --since today --no-pager
journalctl -u app-worker -p err     # errors only
journalctl -u app-worker -o json    # structured JSON output
```

### Watchdog Integration (systemd Type=notify)
```typescript
// Requires Type=notify and WatchdogSec in the unit file
import { notify } from 'sd-notify';

// Signal ready to systemd
notify.ready();

// Ping watchdog at half the WatchdogSec interval
setInterval(() => notify.watchdog(), 15000);

// Report status
notify.status('Processing 42 jobs');
```

### launchd Plist (macOS)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.app.worker</string>
    <key>ProgramArguments</key>
    <array><string>/usr/local/bin/node</string><string>/opt/app/dist/worker.js</string></array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/var/log/app-worker.log</string>
    <key>StandardErrorPath</key><string>/var/log/app-worker.err</string>
    <key>EnvironmentVariables</key>
    <dict><key>NODE_ENV</key><string>production</string></dict>
</dict>
</plist>
```

## Scheduling

### node-cron
```typescript
import cron from 'node-cron';
cron.schedule('*/5 * * * *', () => runTask('cleanup'), { timezone: 'UTC' });
cron.schedule('0 */6 * * *', () => runTask('report'));
cron.schedule('0 2 * * 0', () => runTask('weekly-backup'));
```

### Cron Expression Reference
```
┌──── minute (0-59)
│ ┌──── hour (0-23)
│ │ ┌──── day of month (1-31)
│ │ │ ┌──── month (1-12)
│ │ │ │ ┌──── day of week (0-7, 0&7=Sun)
* * * * *
*/5 * * * *    every 5 min
0 */2 * * *    every 2 hours
0 9 * * 1-5    9am weekdays
0 0 1 * *      midnight 1st of month
```

## Docker Patterns

### Multi-stage Dockerfile (Node.js)
```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src/ src/
RUN npm run build && npm prune --production

# Stage 2: Runtime
FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
```

### docker-compose.yml
```yaml
services:
  app:
    build: .
    ports: ['8080:8080']
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/appdb
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    networks: [backend]

  worker:
    build: .
    command: ['node', 'dist/worker.js']
    environment:
      DATABASE_URL: postgres://app:secret@postgres:5432/appdb
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    restart: unless-stopped
    deploy:
      replicas: 2
    networks: [backend]

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: appdb
    volumes: ['pgdata:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U app']
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [backend]

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes: ['redisdata:/data']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [backend]

volumes:
  pgdata:
  redisdata:

networks:
  backend:
    driver: bridge
```

### .dockerignore
```
node_modules
dist
.git
.env*
*.md
.vscode
.idea
coverage
.nyc_output
```

## Observability (Logging + Metrics)

### Structured Logging with Pino
```typescript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  serializers: { err: pino.stdSerializers.err },
  base: { service: 'api', version: process.env.npm_package_version },
});

// Child loggers inherit config and add context
const jobLogger = logger.child({ module: 'worker' });
jobLogger.info({ jobId: '123', queue: 'tasks' }, 'Job started');
jobLogger.error({ jobId: '123', err }, 'Job failed');

// Express request logging middleware
import pinoHttp from 'pino-http';
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/health' },
}));
```

### Prometheus Metrics
```typescript
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register });

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

const jobsActive = new Gauge({
  name: 'jobs_active',
  help: 'Currently active jobs',
  registers: [register],
});

// Middleware
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.route?.path ?? req.path });
  res.on('finish', () => {
    end();
    httpRequests.inc({ method: req.method, route: req.route?.path ?? req.path, status: res.statusCode });
  });
  next();
});

// Scrape endpoint
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### OpenTelemetry Tracing
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({ [ATTR_SERVICE_NAME]: 'api' }),
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': { enabled: true },
    '@opentelemetry/instrumentation-express': { enabled: true },
    '@opentelemetry/instrumentation-pg': { enabled: true },
    '@opentelemetry/instrumentation-ioredis': { enabled: true },
  })],
});

sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

## CI/CD Patterns

### GitHub Actions Workflow
```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    services:
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: --health-cmd "redis-cli ping" --health-interval 10s
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/test
          REDIS_URL: redis://localhost:6379

  docker:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Redis Patterns

### Connection with ioredis
```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  enableReadyCheck: true,
  lazyConnect: true,
});
await redis.connect();

redis.on('error', (err) => console.error('Redis error:', err));
redis.on('connect', () => console.log('Redis connected'));
```

### Pub/Sub
```typescript
const sub = new Redis();
const pub = new Redis();

await sub.subscribe('events', 'notifications');
sub.on('message', (channel, message) => {
  const data = JSON.parse(message);
  console.log(`[${channel}]`, data);
});

await pub.publish('events', JSON.stringify({ type: 'user.created', userId: '123' }));

// Pattern subscribe
await sub.psubscribe('user:*');
sub.on('pmessage', (pattern, channel, message) => {
  console.log(`[${pattern}] ${channel}:`, message);
});
```

### Caching Patterns
```typescript
// Cache-aside (lazy loading)
async function cacheAside<T>(key: string, ttl: number, fetch: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const data = await fetch();
  await redis.set(key, JSON.stringify(data), 'EX', ttl);
  return data;
}
const user = await cacheAside(`user:${id}`, 3600, () => db.user.findUnique({ where: { id } }));

// Write-through
async function writeThrough<T>(key: string, ttl: number, data: T, persist: (d: T) => Promise<void>) {
  await persist(data);
  await redis.set(key, JSON.stringify(data), 'EX', ttl);
}

// Pattern delete (use SCAN, never KEYS in production)
async function delPattern(pattern: string) {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}
```

### Rate Limiting with Sorted Sets
```typescript
async function isRateLimited(key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now, `${now}:${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, windowSec);
  const results = await multi.exec();
  const count = results![2][1] as number;
  return count > limit;
}

// 100 requests per 60 seconds per IP
if (await isRateLimited(`rate:${ip}`, 100, 60)) {
  res.status(429).json({ error: 'Too many requests' });
  return;
}
```

### Distributed Lock (Redlock)
```typescript
import Redlock from 'redlock';

const redlock = new Redlock([redis], {
  driftFactor: 0.01,
  retryCount: 5,
  retryDelay: 200,
  retryJitter: 100,
  automaticExtensionThreshold: 500,
});

// Acquire lock, run work, auto-release
await redlock.using(['lock:invoice:123'], 10000, async (signal) => {
  if (signal.aborted) throw signal.error;
  await generateInvoice('123');
});

// Manual acquire/release
const lock = await redlock.acquire(['lock:deploy'], 30000);
try {
  await deploy();
} finally {
  await lock.release();
}
```

### Streams (Event Sourcing)
```typescript
// Producer
await redis.xadd('events:orders', '*',
  'type', 'order.created',
  'data', JSON.stringify({ orderId: '456', total: 99.99 }),
);

// Consumer group setup
await redis.xgroup('CREATE', 'events:orders', 'workers', '0', 'MKSTREAM').catch(() => {});

// Consumer loop
async function consumeStream(group: string, consumer: string) {
  while (true) {
    const results = await redis.xreadgroup(
      'GROUP', group, consumer,
      'COUNT', 10, 'BLOCK', 5000,
      'STREAMS', 'events:orders', '>',
    );
    if (!results) continue;
    for (const [, messages] of results) {
      for (const [id, fields] of messages) {
        const event = { type: fields[1], data: JSON.parse(fields[3]) };
        await processEvent(event);
        await redis.xack('events:orders', group, id);
      }
    }
  }
}
consumeStream('workers', 'worker-1');
```

## Monitoring & Health Checks

### Health Check Server
```typescript
import { createServer } from 'node:http';
const health = { status: 'ok', uptime: 0, jobs: { completed: 0, failed: 0, active: 0 } };

createServer((req, res) => {
  if (req.url === '/health') {
    health.uptime = process.uptime();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  } else { res.writeHead(404); res.end(); }
}).listen(9090);

worker.on('completed', () => health.jobs.completed++);
worker.on('failed', () => health.jobs.failed++);
worker.on('active', () => health.jobs.active++);
```

### Queue Metrics
```typescript
async function getMetrics(queue: Queue) {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(), queue.getActiveCount(),
    queue.getCompletedCount(), queue.getFailedCount(), queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed, isPaused: await queue.isPaused() };
}
```
