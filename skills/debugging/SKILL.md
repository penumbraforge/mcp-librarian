---
name: debugging
description: "Systematic debugging methodology, Node.js debugging, Python debugging, browser DevTools, structured logging, memory leaks, deadlocks, distributed tracing, and profiling."
domain: general
version: "1.0"
---

# Debugging Reference Dictionary

## Systematic Methodology

### The Scientific Method for Debugging

```
1. REPRODUCE: Can you reliably trigger the bug?
   - Get exact steps to reproduce
   - Note the environment (OS, browser, versions)
   - Check if it's intermittent or consistent
   - Try to create a minimal reproduction

2. OBSERVE: What actually happens vs what should happen?
   - Read error messages carefully (every word matters)
   - Check logs (application, system, database)
   - Note the exact behavior, not your interpretation

3. HYPOTHESIZE: What could cause this?
   - List 3-5 possible causes, ranked by likelihood
   - Consider recent changes (git log, deployments)
   - Check for environmental differences (dev vs prod)

4. TEST: Validate or eliminate each hypothesis
   - Change ONE thing at a time
   - Use binary search to narrow the cause
   - Add logging/breakpoints at strategic points

5. FIX: Apply the smallest targeted change
   - Fix the root cause, not the symptom
   - Write a test that catches the bug
   - Consider if the same bug could exist elsewhere

6. VERIFY: Confirm the fix
   - Run the reproduction steps again
   - Check that tests pass
   - Check that nothing else broke (regression)
```

### Binary Search Debugging

```
# Narrow down the problem by halving the search space

# In code: Comment out half the code
# If bug persists: problem is in remaining half
# If bug disappears: problem is in commented half
# Repeat until you find the exact line

# In time: Use git bisect
git bisect start
git bisect bad HEAD          # current version is broken
git bisect good v1.0.0       # this version was working
# Git checks out midpoint; test and mark good/bad
# Log2(N) steps to find the breaking commit

# In data: Process half the input
# If bug with first half: problem is data-dependent, narrow further
# If bug with second half: same approach
# If bug only with all data: interaction between records

# In dependencies: Remove half the imports/services
# If bug with half removed: not those deps
# If bug disappears: one of the removed deps is the cause
```

### Rubber Duck Debugging

```
# Explain the problem out loud (to a rubber duck, colleague, or written):

1. "The function is supposed to..."
2. "It receives this input..."
3. "First it does X, which should produce..."
4. "Then it does Y..." <- often the moment you spot the bug

# Writing a detailed bug report often reveals the cause before filing it

# Questions to ask yourself:
- What assumptions am I making?
- What has changed recently?
- Have I read the actual error message?
- Am I looking at the right log/file/service?
- Is this the same code that's deployed?
- Am I sure the data is what I think it is?
```

## Node.js Debugging

### Built-in Debugger

```bash
# Start Node.js with debugger
node --inspect server.js              # listen on 9229
node --inspect-brk server.js          # break on first line
node --inspect=0.0.0.0:9229 server.js # listen on all interfaces

# Connect from Chrome DevTools:
# Open chrome://inspect
# Click "inspect" under Remote Target

# VS Code launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Server",
      "program": "${workspaceFolder}/src/server.ts",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx"],
      "console": "integratedTerminal",
      "env": { "NODE_ENV": "development" }
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Process",
      "port": 9229,
      "restart": true
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Test",
      "program": "${workspaceFolder}/node_modules/.bin/jest",
      "args": ["--runInBand", "${file}"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Console Debugging

```javascript
// Basic logging
console.log('value:', variable);
console.log('user:', JSON.stringify(user, null, 2));

// Table for arrays/objects
console.table([{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }]);

// Timing
console.time('db-query');
const result = await db.query('SELECT * FROM users');
console.timeEnd('db-query');  // db-query: 45.23ms

// Counting
function handleRequest(req) {
  console.count(`request:${req.method}`);
  // request:GET: 1, request:GET: 2, request:POST: 1, ...
}

// Stack trace
console.trace('How did we get here?');

// Conditional breakpoint
debugger;  // Unconditional break
if (user.id === 'problem-user') debugger;  // Conditional

// Group related logs
console.group('Request Processing');
console.log('Method:', req.method);
console.log('Path:', req.path);
console.log('Body:', req.body);
console.groupEnd();

// Assert (logs error if condition is false)
console.assert(user.age >= 0, 'Age should be non-negative', user);

// Structured logging with pino (production)
const pino = require('pino');
const logger = pino({ level: 'debug' });
logger.info({ userId: user.id, action: 'login' }, 'User logged in');
logger.error({ err, requestId: req.id }, 'Failed to process payment');
```

### Memory Debugging

```javascript
// Check memory usage
console.log(process.memoryUsage());
// { rss: 50MB, heapTotal: 30MB, heapUsed: 25MB, external: 2MB }

// Heap snapshot
const v8 = require('v8');
const fs = require('fs');

function takeHeapSnapshot() {
  const snapshotStream = v8.writeHeapSnapshot();
  console.log(`Heap snapshot written to ${snapshotStream}`);
  // Load in Chrome DevTools > Memory tab
}

// Manual GC (start with --expose-gc)
// node --expose-gc server.js
if (global.gc) {
  global.gc();
  console.log('After GC:', process.memoryUsage().heapUsed);
}

// Track object allocations
const { Session } = require('inspector');
const session = new Session();
session.connect();

session.post('HeapProfiler.enable');
session.post('HeapProfiler.startSampling');
// ... run code ...
session.post('HeapProfiler.stopSampling', (err, { profile }) => {
  fs.writeFileSync('heap-profile.json', JSON.stringify(profile));
  // Load in Chrome DevTools > Memory tab
});

// Common Node.js memory leak patterns
// 1. Event listeners not removed
emitter.on('data', handler);  // Add
emitter.removeListener('data', handler);  // Must remove when done!
// Check: emitter.listenerCount('data')

// 2. Closures capturing large objects
function createHandler() {
  const largeData = loadHugeFile();  // Captured by closure!
  return (req, res) => {
    res.json(process(largeData));
  };
}

// 3. Global caches without eviction
const cache = {};  // Grows forever!
// Fix: Use LRU cache
const LRU = require('lru-cache');
const cache2 = new LRU({ max: 500, ttl: 1000 * 60 * 5 });

// 4. Unresolved promises
const promises = [];
function processItem(item) {
  promises.push(fetch(item.url));  // Array grows forever
}
// Fix: Limit concurrency, resolve/discard completed promises
```

### CPU Profiling

```javascript
// Built-in profiler
// node --prof server.js
// Process the output:
// node --prof-process isolate-0x...log > profile.txt

// Programmatic profiling
const { Session } = require('inspector');

function profileFor(durationMs) {
  return new Promise((resolve) => {
    const session = new Session();
    session.connect();
    session.post('Profiler.enable', () => {
      session.post('Profiler.start', () => {
        setTimeout(() => {
          session.post('Profiler.stop', (err, { profile }) => {
            const filename = `cpu-profile-${Date.now()}.cpuprofile`;
            require('fs').writeFileSync(filename, JSON.stringify(profile));
            console.log(`CPU profile saved to ${filename}`);
            resolve(filename);
          });
        }, durationMs);
      });
    });
  });
}

// Clinic.js (comprehensive Node.js diagnostics)
// npx clinic doctor -- node server.js
// npx clinic flame -- node server.js
// npx clinic bubbleprof -- node server.js
```

### Async Debugging

```javascript
// Enable async stack traces
// node --async-stack-traces server.js (default in Node 16+)

// Track unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production: log and potentially exit
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Always exit after uncaughtException (state is unreliable)
  process.exit(1);
});

// Debug hanging async operations
// Why is my process not exiting?
const wtfnode = require('wtfnode');
wtfnode.dump();  // Shows open handles: timers, sockets, etc.

// Or use why-is-node-running
const log = require('why-is-node-running');
setTimeout(() => log(), 5000);  // Show what's keeping Node alive

// AsyncLocalStorage for request context tracking
const { AsyncLocalStorage } = require('async_hooks');
const requestContext = new AsyncLocalStorage();

app.use((req, res, next) => {
  const context = { requestId: crypto.randomUUID(), startTime: Date.now() };
  requestContext.run(context, next);
});

// Anywhere in async call chain:
function doSomething() {
  const ctx = requestContext.getStore();
  console.log(`[${ctx?.requestId}] doing something`);
}
```

## Python Debugging

### pdb / ipdb

```python
# Insert breakpoint
breakpoint()  # Python 3.7+ (uses pdb by default)
import pdb; pdb.set_trace()  # explicit pdb
import ipdb; ipdb.set_trace()  # ipdb (better UI)

# pdb commands:
# n (next)       - Execute next line
# s (step)       - Step into function
# c (continue)   - Continue to next breakpoint
# r (return)     - Continue until current function returns
# l (list)       - Show current code context
# ll             - Show entire function
# p expr         - Print expression
# pp expr        - Pretty-print expression
# w (where)      - Print stack trace
# u (up)         - Move up the call stack
# d (down)       - Move down the call stack
# b line         - Set breakpoint at line
# b func         - Set breakpoint at function
# cl             - Clear breakpoints
# q (quit)       - Quit debugger

# Conditional breakpoint
import pdb; pdb.set_trace() if user_id == 'problem-user' else None

# Post-mortem debugging (after an exception)
try:
    buggy_function()
except:
    import pdb; pdb.post_mortem()

# Or run script with pdb
# python -m pdb script.py
# Then: c (continue), and pdb activates on crash

# Remote debugging with debugpy (VS Code)
import debugpy
debugpy.listen(5678)
debugpy.wait_for_client()  # pause until debugger connects
breakpoint()
```

### Python Profiling

```python
# cProfile: function-level profiling
import cProfile
import pstats

# Profile a function
cProfile.run('main()', 'output.prof')

# Analyze results
stats = pstats.Stats('output.prof')
stats.sort_stats('cumulative')
stats.print_stats(20)  # top 20 by cumulative time

# Profile a specific block
profiler = cProfile.Profile()
profiler.enable()
# ... code to profile ...
profiler.disable()
profiler.print_stats(sort='cumulative')

# line_profiler: line-by-line profiling
# pip install line_profiler
# @profile decorator then: kernprof -l -v script.py
@profile
def slow_function():
    result = []
    for i in range(10000):        # Line 4: 0.001s
        result.append(i ** 2)     # Line 5: 0.050s
        if i % 100 == 0:         # Line 6: 0.002s
            result.sort()         # Line 7: 2.300s  <-- bottleneck!
    return result

# memory_profiler: line-by-line memory usage
# pip install memory_profiler
# python -m memory_profiler script.py
@profile
def memory_heavy():
    a = [1] * (10 ** 6)        # +7.6 MiB
    b = [2] * (2 * 10 ** 7)   # +152.5 MiB
    del b                       # -152.5 MiB
    return a

# py-spy: sampling profiler (no code changes needed)
# pip install py-spy
# py-spy record -o profile.svg -- python server.py  # flame graph
# py-spy top -- python server.py                     # top-like view
# py-spy dump --pid 12345                            # dump running process

# tracemalloc: memory allocation tracking
import tracemalloc
tracemalloc.start()

# ... code ...

snapshot = tracemalloc.take_snapshot()
top_stats = snapshot.statistics('lineno')
for stat in top_stats[:10]:
    print(stat)
```

### Python Memory Leaks

```python
# objgraph: visualize object references
import objgraph

# Show most common types
objgraph.show_most_common_types(limit=20)

# Show growth between snapshots
objgraph.show_growth()  # call twice to see what's accumulating

# Find what refers to an object
objgraph.show_backrefs(
    objgraph.by_type('MyClass')[:3],
    max_depth=5,
    filename='refs.png'
)

# Common Python memory leak patterns
# 1. Circular references with __del__
class Parent:
    def __init__(self):
        self.child = Child(self)  # circular reference
    def __del__(self):
        print("Parent deleted")  # prevents GC of cycle!

class Child:
    def __init__(self, parent):
        self.parent = parent  # circular reference back

# Fix: Use weakref
import weakref
class Child:
    def __init__(self, parent):
        self.parent = weakref.ref(parent)  # weak reference

# 2. Caches without limits
_cache = {}
def expensive(key):
    if key not in _cache:
        _cache[key] = compute(key)  # grows forever
    return _cache[key]

# Fix: Use functools.lru_cache or cachetools
from functools import lru_cache

@lru_cache(maxsize=1024)
def expensive(key):
    return compute(key)

# 3. Unremoved callbacks/observers
# 4. Global lists/dicts that accumulate
# 5. Threads that aren't joined
```

## Browser DevTools

### Chrome DevTools Debugging

```javascript
// Console utilities available only in DevTools console
$0             // Currently selected DOM element
$('selector')  // querySelector shortcut
$$('selector') // querySelectorAll shortcut
$x('//xpath')  // XPath query
copy(object)   // Copy to clipboard
monitor(fn)    // Log when function is called
unmonitor(fn)  // Stop monitoring
monitorEvents(element, 'click') // Log all click events
getEventListeners($0)           // Get element's event listeners

// Performance debugging
console.time('render');
renderComponent();
console.timeEnd('render');

console.profile('My Profile');
heavyComputation();
console.profileEnd('My Profile');

// Memory debugging
performance.mark('start');
heavyOperation();
performance.mark('end');
performance.measure('operation', 'start', 'end');
console.log(performance.getEntriesByType('measure'));
```

### Network Debugging

```javascript
// In DevTools Console:
// Copy request as fetch
// Right-click request -> Copy -> Copy as fetch

// Intercept fetch for debugging
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  console.log('Fetch:', args[0], args[1]);
  const start = performance.now();
  try {
    const response = await originalFetch(...args);
    console.log(`Fetch complete: ${response.status} (${(performance.now() - start).toFixed(1)}ms)`);
    return response;
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
};

// Performance Observer for network timing
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((entry) => {
    if (entry.entryType === 'resource') {
      console.log(`${entry.name}: ${entry.duration.toFixed(1)}ms`);
    }
  });
});
observer.observe({ entryTypes: ['resource'] });
```

### DOM Debugging

```javascript
// Break on DOM changes
// Right-click element -> Break on -> subtree modifications/attribute modifications/node removal

// Watch for DOM mutations in console
const observer = new MutationObserver((mutations) => {
  mutations.forEach((m) => {
    console.log('DOM mutation:', m.type, m.target, m);
  });
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true,
});

// Find the JS that changed a style
// Sources -> Event Listener Breakpoints -> DOM Mutation

// Debug CSS: force element state
// Elements panel -> :hov button -> :hover, :focus, :active, etc.

// Debug layout shifts
// Performance -> Check "Layout Shifts" in recording
// Or: new PerformanceObserver((list) => {
//   list.getEntries().forEach(e => console.log('Layout shift:', e));
// }).observe({ entryTypes: ['layout-shift'] });

// Debug rendering
// More tools -> Rendering -> Paint flashing, Layer borders
// FPS meter, scrolling performance issues
```

### React DevTools

```javascript
// React Developer Tools browser extension

// Access React component from console
// Select component in React DevTools, then in console:
$r           // currently selected React component
$r.props     // its props
$r.state     // its state

// Debug re-renders
// React DevTools -> Profiler -> Record -> interact -> Stop
// Shows: commit times, component render times, why components rendered

// Highlight re-renders
// React DevTools -> Settings -> Highlight updates when components render

// Use React.memo debugging
const MyComponent = React.memo(({ data }) => {
  console.log('MyComponent rendered');
  return <div>{data.name}</div>;
}, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render)
  console.log('Comparing props:', prevProps, nextProps);
  return prevProps.data.id === nextProps.data.id;
});

// useDebugValue for custom hooks
function useUserStatus(userId) {
  const [status, setStatus] = useState('loading');
  useDebugValue(status); // Shows in React DevTools
  // ...
  return status;
}

// Why did you render (library)
// npm install @welldone-software/why-did-you-render
import React from 'react';
import whyDidYouRender from '@welldone-software/why-did-you-render';
whyDidYouRender(React, { trackAllPureComponents: true });
```

## Structured Logging

### Logging Best Practices

```javascript
// Use structured (JSON) logging in production
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: ['req.headers.authorization', 'password', '*.token'],
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

// Structured log entries
logger.info({ userId: '123', action: 'login', ip: '1.2.3.4' }, 'User logged in');
logger.error({ err, orderId: '456', step: 'payment' }, 'Payment processing failed');
logger.warn({ queueDepth: 1000, threshold: 500 }, 'Queue depth exceeds threshold');

// Child loggers for context
const reqLogger = logger.child({ requestId: req.id, userId: req.user?.id });
reqLogger.info({ path: req.path }, 'Request started');
// All logs from reqLogger include requestId and userId

// Output (JSON, one line per entry):
// {"level":"info","time":1710000000,"requestId":"abc","userId":"123","path":"/api/users","msg":"Request started"}
```

```python
# Python: structlog for structured logging
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
)

logger = structlog.get_logger()

# Bind context
log = logger.bind(request_id="abc123", user_id="user-1")
log.info("request_started", path="/api/users", method="GET")
log.error("payment_failed", order_id="order-456", error=str(e))

# Context variables (across async calls)
structlog.contextvars.bind_contextvars(request_id="abc123")
# All subsequent logs include request_id automatically
```

### Log Levels Guide

```
TRACE  - Very detailed debugging (function entry/exit, loop iterations)
DEBUG  - Detailed debugging info (variable values, decision points)
INFO   - Normal operations (request completed, job started, config loaded)
WARN   - Something unexpected but recoverable (retry, degraded service, slow query)
ERROR  - Operation failed (exception caught, API call failed, data inconsistency)
FATAL  - System cannot continue (port in use, DB unreachable, out of memory)

# Rules:
# - INFO should tell the story of what the system is doing
# - ERROR means someone needs to investigate eventually
# - WARN means "keep an eye on this"
# - DEBUG is for development and troubleshooting
# - Never log sensitive data (passwords, tokens, PII)
# - Always include correlation IDs (requestId, traceId)
# - Log the "why" not just the "what" (include context)
```

### Request Logging Middleware

```javascript
// Express.js request logging
function requestLogger(logger) {
  return (req, res, next) => {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = requestId;
    req.log = logger.child({ requestId });

    req.log.info({ method: req.method, path: req.path, query: req.query }, 'Request started');

    // Capture response
    const originalEnd = res.end;
    res.end = function (...args) {
      const duration = Date.now() - start;
      const logData = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        contentLength: res.getHeader('content-length'),
      };

      if (res.statusCode >= 500) {
        req.log.error(logData, 'Request failed');
      } else if (res.statusCode >= 400) {
        req.log.warn(logData, 'Client error');
      } else {
        req.log.info(logData, 'Request completed');
      }

      originalEnd.apply(res, args);
    };

    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
```

## Memory Leaks

### Identifying Memory Leaks

```bash
# Node.js: Monitor memory over time
node --max-old-space-size=512 server.js

# Watch memory growth
watch -n 5 'curl -s localhost:3000/debug/memory | jq .'

# Generate heap snapshots at intervals
# Take snapshot 1, do some operations, take snapshot 2
# Compare in Chrome DevTools Memory tab -> Comparison view
```

```javascript
// Expose memory debug endpoint (development only!)
app.get('/debug/memory', (req, res) => {
  if (process.env.NODE_ENV !== 'development') return res.sendStatus(404);

  const mem = process.memoryUsage();
  res.json({
    rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
    heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
    heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
    external: `${(mem.external / 1024 / 1024).toFixed(1)} MB`,
    arrayBuffers: `${(mem.arrayBuffers / 1024 / 1024).toFixed(1)} MB`,
  });
});

// Detect memory leak pattern
let samples = [];
setInterval(() => {
  const used = process.memoryUsage().heapUsed;
  samples.push(used);
  if (samples.length > 60) samples.shift();  // keep last 60

  // Check for consistent growth
  if (samples.length === 60) {
    const firstHalf = samples.slice(0, 30).reduce((a, b) => a + b) / 30;
    const secondHalf = samples.slice(30).reduce((a, b) => a + b) / 30;
    if (secondHalf > firstHalf * 1.2) {
      console.warn('Possible memory leak detected', {
        firstHalfAvg: `${(firstHalf / 1024 / 1024).toFixed(1)} MB`,
        secondHalfAvg: `${(secondHalf / 1024 / 1024).toFixed(1)} MB`,
      });
    }
  }
}, 10000);  // every 10 seconds
```

### Common Memory Leak Patterns

```javascript
// LEAK 1: Event emitter listeners
class DataProcessor extends EventEmitter {
  constructor(source) {
    super();
    // BAD: listener added every time a new instance subscribes
    source.on('data', (data) => this.process(data));
    // FIX: store reference and remove in cleanup
    this._handler = (data) => this.process(data);
    source.on('data', this._handler);
  }

  destroy() {
    source.removeListener('data', this._handler);
  }
}

// LEAK 2: Closures holding references
function createCacheManager() {
  const cache = new Map();

  return {
    set(key, value) {
      cache.set(key, {
        value,
        timestamp: Date.now(),
        metadata: new Array(10000).fill('x'), // large object in closure
      });
    },
    // FIX: Add eviction
    cleanup() {
      const maxAge = 5 * 60 * 1000;
      for (const [key, entry] of cache) {
        if (Date.now() - entry.timestamp > maxAge) {
          cache.delete(key);
        }
      }
    },
  };
}

// LEAK 3: Timers not cleaned up
class Component {
  start() {
    // BAD: interval never cleared
    setInterval(() => this.poll(), 1000);

    // FIX: store and clear
    this._interval = setInterval(() => this.poll(), 1000);
  }

  destroy() {
    clearInterval(this._interval);
  }
}

// LEAK 4: Accumulating buffers
class StreamProcessor {
  constructor() {
    this.chunks = []; // BAD: grows without limit
  }

  onData(chunk) {
    this.chunks.push(chunk);
    // FIX: Process and discard, or set a limit
    if (this.chunks.length > 1000) {
      this.flush();
    }
  }

  flush() {
    const data = Buffer.concat(this.chunks);
    this.chunks = []; // Clear accumulated data
    return this.process(data);
  }
}
```

## Deadlocks

### Database Deadlock Detection

```sql
-- PostgreSQL: View current locks
SELECT
    l.pid,
    l.locktype,
    l.mode,
    l.granted,
    a.query,
    a.state,
    a.wait_event_type,
    a.wait_event,
    age(now(), a.query_start) AS query_age
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE NOT l.granted
ORDER BY a.query_start;

-- PostgreSQL: Find blocking queries
SELECT
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query,
    age(now(), blocked.query_start) AS blocked_duration
FROM pg_stat_activity blocked
JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
JOIN pg_locks bl2 ON bl2.locktype = bl.locktype
    AND bl2.database IS NOT DISTINCT FROM bl.database
    AND bl2.relation IS NOT DISTINCT FROM bl.relation
    AND bl2.page IS NOT DISTINCT FROM bl.page
    AND bl2.tuple IS NOT DISTINCT FROM bl.tuple
    AND bl2.granted
JOIN pg_stat_activity blocking ON bl2.pid = blocking.pid
WHERE blocked.pid != blocking.pid;

-- MySQL: Show InnoDB lock waits
SELECT * FROM information_schema.innodb_lock_waits;
SELECT * FROM sys.innodb_lock_waits;
SHOW ENGINE INNODB STATUS;  -- look for "LATEST DETECTED DEADLOCK"
```

### Application-Level Deadlocks

```python
# Thread deadlock detection (Python)
import threading
import signal
import sys
import traceback

def dump_threads(signum, frame):
    """Signal handler to dump all thread stacks."""
    print("\n=== Thread Dump ===")
    for thread_id, stack in sys._current_frames().items():
        thread = threading.current_thread()
        for t in threading.enumerate():
            if t.ident == thread_id:
                thread = t
                break
        print(f"\nThread: {thread.name} (daemon={thread.daemon})")
        traceback.print_stack(stack)
    print("=== End Thread Dump ===\n")

# Register signal handler (Linux/macOS)
signal.signal(signal.SIGUSR1, dump_threads)
# Kill -USR1 <pid> to trigger thread dump

# Deadlock prevention: timeout on locks
lock = threading.Lock()
acquired = lock.acquire(timeout=5)
if not acquired:
    raise TimeoutError("Could not acquire lock within 5 seconds")
try:
    # critical section
    pass
finally:
    lock.release()

# Deadlock prevention: lock ordering
# Always acquire locks in the same global order
def transfer(account_a, account_b, amount):
    # Sort by ID to ensure consistent ordering
    first, second = sorted([account_a, account_b], key=lambda a: a.id)
    with first.lock:
        with second.lock:
            account_a.balance -= amount
            account_b.balance += amount
```

```javascript
// Node.js: detect potential deadlocks in async code
// (not true deadlocks, but stuck promises/callbacks)

function withTimeout(promise, ms, label) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout: ${label} took > ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

// Usage
try {
  const result = await withTimeout(
    db.query('SELECT * FROM large_table'),
    5000,
    'large_table_query'
  );
} catch (err) {
  if (err.message.startsWith('Timeout:')) {
    logger.error({ err }, 'Potential deadlock or slow query detected');
  }
}
```

## Distributed Tracing

### OpenTelemetry Setup

```javascript
// Node.js OpenTelemetry instrumentation
// npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node

// tracing.js (import before all other code)
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'my-api-service',
});

sdk.start();

// Custom spans
const { trace } = require('@opentelemetry/api');

async function processOrder(order) {
  const tracer = trace.getTracer('order-service');
  return tracer.startActiveSpan('processOrder', async (span) => {
    try {
      span.setAttribute('order.id', order.id);
      span.setAttribute('order.total', order.total);

      // Child span for database operation
      await tracer.startActiveSpan('db.saveOrder', async (dbSpan) => {
        await db.orders.create(order);
        dbSpan.end();
      });

      // Child span for external service call
      await tracer.startActiveSpan('payment.charge', async (paymentSpan) => {
        paymentSpan.setAttribute('payment.method', order.paymentMethod);
        await paymentService.charge(order);
        paymentSpan.end();
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}
```

```python
# Python OpenTelemetry
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer("order-service")

@tracer.start_as_current_span("process_order")
async def process_order(order):
    span = trace.get_current_span()
    span.set_attribute("order.id", order.id)

    with tracer.start_as_current_span("db.save_order"):
        await db.orders.create(order)

    with tracer.start_as_current_span("payment.charge"):
        await payment_service.charge(order)
```

### Correlation IDs

```javascript
// Pass trace context across service boundaries
// Middleware to extract/create correlation ID
function correlationId(req, res, next) {
  // Extract from incoming request headers
  const traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  const spanId = crypto.randomUUID().slice(0, 16);

  req.traceContext = { traceId, spanId };
  res.set('X-Trace-Id', traceId);

  next();
}

// Pass to downstream services
async function callUserService(userId, traceContext) {
  return fetch(`http://user-service/users/${userId}`, {
    headers: {
      'X-Trace-Id': traceContext.traceId,
      'X-Parent-Span-Id': traceContext.spanId,
    },
  });
}

// Include in all log entries
function createRequestLogger(req) {
  return logger.child({
    traceId: req.traceContext.traceId,
    spanId: req.traceContext.spanId,
    service: 'api-gateway',
  });
}
```

## Profiling and Performance

### Web Vitals Debugging

```javascript
// Measure Core Web Vitals
import { onCLS, onFID, onLCP, onFCP, onTTFB, onINP } from 'web-vitals';

function sendToAnalytics(metric) {
  console.log(`${metric.name}: ${metric.value.toFixed(1)}${metric.name === 'CLS' ? '' : 'ms'}`);
  // Send to analytics backend
}

onCLS(sendToAnalytics);   // Cumulative Layout Shift (< 0.1 good)
onFID(sendToAnalytics);   // First Input Delay (< 100ms good)
onLCP(sendToAnalytics);   // Largest Contentful Paint (< 2.5s good)
onFCP(sendToAnalytics);   // First Contentful Paint (< 1.8s good)
onTTFB(sendToAnalytics);  // Time to First Byte (< 800ms good)
onINP(sendToAnalytics);   // Interaction to Next Paint (< 200ms good)

// Long Task observer
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((entry) => {
    console.warn(`Long task detected: ${entry.duration.toFixed(1)}ms`, {
      name: entry.name,
      startTime: entry.startTime,
    });
  });
});
observer.observe({ entryTypes: ['longtask'] });
```

### Database Query Profiling

```javascript
// Log slow queries (Prisma)
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
});

prisma.$on('query', (e) => {
  if (e.duration > 100) {  // log queries > 100ms
    logger.warn({
      query: e.query,
      params: e.params,
      duration: e.duration,
    }, 'Slow query detected');
  }
});

// Log slow queries (Knex)
const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 2, max: 10 },
});

knex.on('query', (data) => {
  data.__startTime = Date.now();
});

knex.on('query-response', (response, data) => {
  const duration = Date.now() - data.__startTime;
  if (duration > 100) {
    logger.warn({ sql: data.sql, bindings: data.bindings, duration }, 'Slow query');
  }
});
```

## Debugging Checklists

### API Not Responding

```
1. Is the process running?
   ps aux | grep node
   docker ps

2. Is it listening on the right port?
   lsof -i :3000
   netstat -tlnp | grep 3000
   ss -tlnp | grep 3000

3. Can you reach it locally?
   curl http://localhost:3000/health

4. Check logs for errors
   docker logs container_name --tail 100
   journalctl -u my-service --since "5 min ago"

5. Is it a DNS/network issue?
   dig api.example.com
   curl -v https://api.example.com/health

6. Is it a resource issue?
   top, htop (CPU/memory)
   df -h (disk space)
   ulimit -a (file descriptors)

7. Is the database accessible?
   pg_isready -h localhost -p 5432
   redis-cli ping

8. Check for recent deployments
   git log --oneline -5
```

### Performance Degradation

```
1. When did it start?
   - Check monitoring dashboards (Grafana, DataDog)
   - Correlate with deployments, traffic changes, cron jobs

2. What's slow?
   - Response time percentiles (p50, p95, p99)
   - Which endpoints are affected?
   - Is it CPU, memory, I/O, or network?

3. Database?
   - Slow query log
   - Lock contention
   - Connection pool exhaustion
   - Missing indexes (EXPLAIN ANALYZE)

4. External dependencies?
   - Third-party API latency
   - DNS resolution time
   - SSL certificate issues

5. Application?
   - Memory leak (growing heap)
   - CPU-bound operation blocking event loop
   - Connection pool exhaustion
   - Thread pool starvation

6. Infrastructure?
   - Disk I/O saturation
   - Network bandwidth
   - Container resource limits hit
   - Node scaling needed
```
