---
name: automation
description: "Worker automation, job queues, process management, scheduling, and monitoring. Load for any BullMQ, cron, or infrastructure task."
---

# Automation & Worker Reference Dictionary

## BullMQ

### Queue Setup
```typescript
import { Queue, Worker, QueueScheduler, FlowProducer } from 'bullmq';
const connection = { host: '127.0.0.1', port: 6379 };

const queue = new Queue('tasks', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  },
});

// Add jobs
await queue.add('process', { url: 'https://example.com' }, { priority: 1 });
await queue.addBulk([
  { name: 'process', data: { id: 1 }, opts: { priority: 2 } },
  { name: 'process', data: { id: 2 }, opts: { priority: 3 } },
]);

// Repeatable (cron)
await queue.upsertJobScheduler('daily-report', { pattern: '0 9 * * *' }, { name: 'report', data: {} });

// Rate limited
const limited = new Queue('api-calls', {
  connection,
  limiter: { max: 10, duration: 1000 }, // 10/sec
});

// Delayed
await queue.add('reminder', data, { delay: 60000 }); // 1min
```

### Worker
```typescript
const worker = new Worker('tasks', async (job) => {
  job.log(`Processing ${job.name} #${job.id}`);
  await job.updateProgress(50);
  const result = await doWork(job.data);
  await job.updateProgress(100);
  return result;
}, {
  connection,
  concurrency: 5,
  limiter: { max: 1, duration: 500 },
  lockDuration: 30000,
  stalledInterval: 15000,
  maxStalledCount: 2,
  autorun: true,
});

worker.on('completed', (job, result) => console.log(`Done: ${job.id}`));
worker.on('failed', (job, err) => console.error(`Fail: ${job?.id}`, err.message));
worker.on('stalled', (jobId) => console.warn(`Stalled: ${jobId}`));
worker.on('error', (err) => console.error('Worker error:', err));
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
  try { return await process(job.data); }
  catch (err) {
    if (job.attemptsMade >= (job.opts.attempts ?? 3) - 1) {
      await dlq.add('failed-task', { originalJob: job.name, data: job.data, error: String(err), failedAt: new Date().toISOString() });
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

### systemd Service
```ini
[Unit]
Description=Worker Service
After=network.target redis.service postgresql.service

[Service]
Type=simple
User=app
WorkingDirectory=/opt/app
ExecStart=/usr/bin/node dist/worker.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=REDIS_URL=redis://localhost:6379
StandardOutput=journal
StandardError=journal
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
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
