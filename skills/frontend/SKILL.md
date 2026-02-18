---
name: frontend
description: "Frontend GUI design with React 19, Tailwind v4, Zustand, animations, charts, and real-time updates. Load for any UI/dashboard task."
domain: frontend
version: "1.0"
---

# Frontend GUI Design Dictionary

## React 19 Patterns

### Form with Validation
```tsx
import { useActionState } from 'react';

function LoginForm() {
  const [state, action, pending] = useActionState(async (_prev: any, fd: FormData) => {
    const email = fd.get('email') as string;
    const pass = fd.get('password') as string;
    if (!email) return { error: 'Email required' };
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, pass }) });
    if (!res.ok) return { error: 'Invalid credentials' };
    return { success: true };
  }, null);

  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="text-red-400 text-sm">{state.error}</p>}
      <input name="email" type="email" placeholder="Email" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input name="password" type="password" placeholder="Password" className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100" />
      <button disabled={pending} className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors">{pending ? 'Signing in...' : 'Sign In'}</button>
    </form>
  );
}
```

### Data Table
```tsx
interface Column<T> { key: keyof T; label: string; render?: (v: T[keyof T], row: T) => React.ReactNode; sortable?: boolean; }

function DataTable<T extends { id: string | number }>({ data, columns, onSort }: { data: T[]; columns: Column<T>[]; onSort?: (key: keyof T, dir: 'asc' | 'desc') => void }) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const handleSort = (key: keyof T) => {
    const dir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
    setSortKey(key); setSortDir(dir); onSort?.(key, dir);
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-700">
      <table className="w-full text-sm text-left text-zinc-300">
        <thead className="bg-zinc-800 text-zinc-400 uppercase text-xs">
          <tr>{columns.map(c => <th key={String(c.key)} onClick={() => c.sortable && handleSort(c.key)} className={`px-4 py-3 ${c.sortable ? 'cursor-pointer hover:text-zinc-200' : ''}`}>{c.label} {sortKey === c.key && (sortDir === 'asc' ? '↑' : '↓')}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-700">
          {data.map(row => <tr key={row.id} className="hover:bg-zinc-800/50">{columns.map(c => <td key={String(c.key)} className="px-4 py-3">{c.render ? c.render(row[c.key], row) : String(row[c.key])}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
```

### Modal
```tsx
import { useRef, useEffect } from 'react';

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { open ? ref.current?.showModal() : ref.current?.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className="backdrop:bg-black/60 bg-zinc-900 text-zinc-100 rounded-xl p-0 max-w-lg w-full border border-zinc-700 shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-xl">&times;</button>
      </div>
      <div className="px-6 py-4">{children}</div>
    </dialog>
  );
}
```

### Toast Notifications
```tsx
import { create } from 'zustand';

type Toast = { id: string; message: string; type: 'success' | 'error' | 'info'; };
const useToasts = create<{ toasts: Toast[]; add: (t: Omit<Toast, 'id'>) => void; remove: (id: string) => void }>((set) => ({
  toasts: [],
  add: (t) => { const id = crypto.randomUUID(); set(s => ({ toasts: [...s.toasts, { ...t, id }] })); setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), 4000); },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
}));

function ToastContainer() {
  const { toasts, remove } = useToasts();
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-blue-600' };
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map(t => <div key={t.id} onClick={() => remove(t.id)} className={`${colors[t.type]} text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer text-sm max-w-sm animate-slide-in`}>{t.message}</div>)}
    </div>
  );
}
```

## Tailwind v4

### Setup
```css
/* src/index.css */
@import "tailwindcss";
@config "../tailwind.config.js";

@theme {
  --color-surface: #1a1a2e;
  --color-surface-alt: #16213e;
  --color-accent: #6366f1;
  --color-accent-hover: #818cf8;
  --color-border: #3f3f46;
  --color-text: #e4e4e7;
  --color-text-muted: #a1a1aa;
}
```

### Layout Patterns
```html
<!-- Dashboard grid -->
<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 p-6">
  <div class="rounded-xl bg-zinc-900 border border-zinc-700 p-4">Card</div>
</div>

<!-- Sidebar + main -->
<div class="flex h-screen">
  <aside class="w-64 shrink-0 border-r border-zinc-700 bg-zinc-900 overflow-y-auto">Nav</aside>
  <main class="flex-1 overflow-y-auto p-6">Content</main>
</div>

<!-- Sticky header -->
<header class="sticky top-0 z-40 border-b border-zinc-700 bg-zinc-900/80 backdrop-blur-sm px-6 py-3">Header</header>

<!-- Stat card -->
<div class="rounded-xl bg-zinc-900 border border-zinc-700 p-6">
  <p class="text-sm text-zinc-400">Total Scans</p>
  <p class="text-3xl font-bold text-zinc-100 mt-1">1,234</p>
  <p class="text-sm text-emerald-400 mt-2">+12% from last month</p>
</div>
```

## Zustand State

### Typed Store
```typescript
import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';

interface AppState {
  user: User | null;
  theme: 'dark' | 'light';
  sidebarOpen: boolean;
  setUser: (u: User | null) => void;
  toggleSidebar: () => void;
  setTheme: (t: 'dark' | 'light') => void;
}

const useStore = create<AppState>()(
  devtools(persist((set) => ({
    user: null,
    theme: 'dark',
    sidebarOpen: true,
    setUser: (user) => set({ user }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setTheme: (theme) => set({ theme }),
  }), { name: 'app-store' }))
);

// Sliced selectors (avoid re-renders)
const user = useStore(s => s.user);
const toggleSidebar = useStore(s => s.toggleSidebar);
```

### Async Store
```typescript
interface DataStore<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  fetch: (url: string) => Promise<void>;
}

const useData = create<DataStore<any>>((set) => ({
  data: [],
  loading: false,
  error: null,
  fetch: async (url) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      set({ data: await res.json(), loading: false });
    } catch (e) { set({ error: String(e), loading: false }); }
  },
}));
```

## Data Visualization (Recharts)

### Line Chart
```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function MetricsChart({ data }: { data: { date: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
        <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} />
        <YAxis stroke="#a1a1aa" fontSize={12} />
        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#e4e4e7' }} />
        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### Bar Chart
```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

function ScanBarChart({ data }: { data: { name: string; count: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <XAxis dataKey="name" stroke="#a1a1aa" fontSize={12} />
        <YAxis stroke="#a1a1aa" fontSize={12} />
        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px' }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

## Real-Time Updates (SSE)

### Client Hook
```typescript
function useSSE<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => setData(JSON.parse(e.data));
    es.onerror = () => { setConnected(false); es.close(); };
    return () => es.close();
  }, [url]);

  return { data, connected };
}
```

### Server Endpoint (Express)
```typescript
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const id = setInterval(() => {
    res.write(`data: ${JSON.stringify({ ts: Date.now(), metrics: getMetrics() })}\n\n`);
  }, 2000);
  req.on('close', () => clearInterval(id));
});
```

## Framer Motion

### Animated List
```tsx
import { motion, AnimatePresence } from 'framer-motion';

function AnimatedList({ items }: { items: { id: string; text: string }[] }) {
  return (
    <AnimatePresence>
      {items.map(item => (
        <motion.div key={item.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{ duration: 0.2 }}
          className="p-4 border-b border-zinc-700"
        >{item.text}</motion.div>
      ))}
    </AnimatePresence>
  );
}
```

### Page Transition
```tsx
const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -10 },
};

function Page({ children }: { children: React.ReactNode }) {
  return <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">{children}</motion.div>;
}
```
