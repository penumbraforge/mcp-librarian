---
name: frontend
description: "Frontend GUI design with React 19, Tailwind v4, Zustand, TanStack Query, React Router v7, animations, charts, forms, a11y, error handling, and performance. Load for any UI/dashboard task."
domain: frontend
version: "2.0"
---

# Frontend GUI Design Dictionary

## React 19 Patterns

### Form with useActionState
```tsx
import { useActionState } from 'react';

function LoginForm() {
  const [state, action, pending] = useActionState(async (_prev: any, fd: FormData) => {
    const email = fd.get('email') as string;
    const pass = fd.get('password') as string;
    if (!email) return { error: 'Email required' };
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pass }),
    });
    if (!res.ok) return { error: 'Invalid credentials' };
    return { success: true };
  }, null);

  return (
    <form action={action} className="space-y-4">
      {state?.error && <p className="text-red-400 text-sm">{state.error}</p>}
      <input name="email" type="email" placeholder="Email"
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      <input name="password" type="password" placeholder="Password"
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100" />
      <button disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors">
        {pending ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
```

### use() Hook for Promises and Context
```tsx
import { use, Suspense } from 'react';

// use() unwraps promises directly in render — replaces useEffect fetch patterns
const dataPromise = fetch('/api/dashboard').then(r => r.json());

function Dashboard() {
  const data = use(dataPromise); // suspends until resolved
  return <div className="text-zinc-100">{data.title}</div>;
}

// Wrap in Suspense at the parent level
function App() {
  return (
    <Suspense fallback={<div className="animate-pulse bg-zinc-800 h-32 rounded-xl" />}>
      <Dashboard />
    </Suspense>
  );
}

// use() also reads context without useContext
import { ThemeContext } from './context';
function ThemedCard() {
  const theme = use(ThemeContext);
  return <div className={theme === 'dark' ? 'bg-zinc-900' : 'bg-white'}>Card</div>;
}
```

### useOptimistic
```tsx
import { useOptimistic, useActionState } from 'react';

interface Todo { id: string; text: string; done: boolean }

function TodoList({ todos, toggleTodo }: { todos: Todo[]; toggleTodo: (id: string) => Promise<void> }) {
  const [optimistic, addOptimistic] = useOptimistic(
    todos,
    (state, toggledId: string) =>
      state.map(t => t.id === toggledId ? { ...t, done: !t.done } : t)
  );

  return (
    <ul className="space-y-2">
      {optimistic.map(t => (
        <li key={t.id}
          onClick={async () => { addOptimistic(t.id); await toggleTodo(t.id); }}
          className={`px-4 py-2 rounded-lg cursor-pointer transition-colors
            ${t.done ? 'bg-zinc-800 text-zinc-500 line-through' : 'bg-zinc-900 text-zinc-100'}`}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}
```

### Data Table
```tsx
interface Column<T> { key: keyof T; label: string; render?: (v: T[keyof T], row: T) => React.ReactNode; sortable?: boolean }

function DataTable<T extends { id: string | number }>({ data, columns, onSort }: {
  data: T[]; columns: Column<T>[]; onSort?: (key: keyof T, dir: 'asc' | 'desc') => void;
}) {
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
          <tr>{columns.map(c => (
            <th key={String(c.key)} onClick={() => c.sortable && handleSort(c.key)}
              className={`px-4 py-3 ${c.sortable ? 'cursor-pointer hover:text-zinc-200' : ''}`}>
              {c.label} {sortKey === c.key && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-700">
          {data.map(row => (
            <tr key={row.id} className="hover:bg-zinc-800/50">
              {columns.map(c => (
                <td key={String(c.key)} className="px-4 py-3">
                  {c.render ? c.render(row[c.key], row) : String(row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Modal
```tsx
import { useRef, useEffect } from 'react';

function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { open ? ref.current?.showModal() : ref.current?.close(); }, [open]);
  return (
    <dialog ref={ref} onClose={onClose}
      className="backdrop:bg-black/60 bg-zinc-900 text-zinc-100 rounded-xl p-0 max-w-lg w-full border border-zinc-700 shadow-2xl">
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

type Toast = { id: string; message: string; type: 'success' | 'error' | 'info' };
const useToasts = create<{
  toasts: Toast[];
  add: (t: Omit<Toast, 'id'>) => void;
  remove: (id: string) => void;
}>((set) => ({
  toasts: [],
  add: (t) => {
    const id = crypto.randomUUID();
    set(s => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), 4000);
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
}));

function ToastContainer() {
  const { toasts, remove } = useToasts();
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-blue-600' };
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} role="alert"
          className={`${colors[t.type]} text-white px-4 py-3 rounded-lg shadow-lg cursor-pointer text-sm max-w-sm animate-slide-in`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

## Tailwind v4

### Setup
```css
/* src/index.css — Tailwind v4 uses @import, NOT @tailwind directives */
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

### @apply Alternatives and Utility Layers
```css
/* Tailwind v4: prefer @theme variables + inline utilities over @apply.
   If you must extract, use CSS custom properties or @utility. */

/* Define reusable utility via @utility (v4 feature) */
@utility card {
  border-radius: theme(borderRadius.xl);
  background-color: theme(colors.zinc.900);
  border: 1px solid theme(colors.zinc.700);
  padding: theme(spacing.6);
}

/* Container queries — v4 has native @container support */
@utility container-card {
  container-type: inline-size;
}
```
```html
<!-- Container queries in markup -->
<div class="container-card">
  <div class="@container">
    <div class="@sm:flex @sm:gap-4 @lg:grid @lg:grid-cols-3">
      <div class="card">Responsive to container, not viewport</div>
    </div>
  </div>
</div>

<!-- Dark mode: Tailwind v4 uses CSS prefers-color-scheme by default.
     For class-based toggling, set darkMode in config. -->
<div class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
  <p class="text-zinc-600 dark:text-zinc-400">Adapts to theme</p>
</div>
```

## Zustand State

### Typed Store with Devtools + Persist
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

// Sliced selectors — prevent unnecessary re-renders
const user = useStore(s => s.user);
const toggleSidebar = useStore(s => s.toggleSidebar);
```

### Computed Values with subscribeWithSelector
```typescript
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface CartStore {
  items: { id: string; price: number; qty: number }[];
  addItem: (item: { id: string; price: number }) => void;
  removeItem: (id: string) => void;
  // Computed — derive in selector, not in store
}

const useCart = create<CartStore>()(
  subscribeWithSelector((set) => ({
    items: [],
    addItem: (item) => set(s => ({
      items: s.items.find(i => i.id === item.id)
        ? s.items.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i)
        : [...s.items, { ...item, qty: 1 }],
    })),
    removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
  }))
);

// Computed selector — recalculates only when items change
const useCartTotal = () => useCart(s =>
  s.items.reduce((sum, i) => sum + i.price * i.qty, 0)
);

// Subscribe to specific slices externally
useCart.subscribe(
  s => s.items.length,
  (count) => console.log(`Cart now has ${count} items`),
);
```

### Persist with Migrations
```typescript
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SettingsStore {
  version: number;
  locale: string;
  notifications: boolean;
  compactMode: boolean;
}

const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      version: 2,
      locale: 'en',
      notifications: true,
      compactMode: false,
    }),
    {
      name: 'settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          // v1 had "lang" instead of "locale"
          return { ...persisted, locale: persisted.lang ?? 'en', compactMode: false };
        }
        return persisted as SettingsStore;
      },
    }
  )
);
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

## TanStack Query

### Basic useQuery + useMutation
```tsx
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Configure once at app root
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 min — data considered fresh
      gcTime: 30 * 60 * 1000,    // 30 min — unused cache eviction (was cacheTime in v4)
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

// Fetch with useQuery
function Dashboard() {
  const { data: scans, isLoading, error } = useQuery({
    queryKey: ['scans'],
    queryFn: () => fetch('/api/scans').then(r => r.json()),
  });

  if (isLoading) return <div className="animate-pulse bg-zinc-800 h-48 rounded-xl" />;
  if (error) return <div className="text-red-400">Failed to load scans</div>;

  return (
    <div className="space-y-4 bg-zinc-900 p-6 rounded-xl">
      {scans.map((s: any) => <ScanRow key={s.id} scan={s} />)}
    </div>
  );
}
```

### Mutations with Optimistic Updates
```tsx
function ScanRow({ scan }: { scan: { id: string; name: string; starred: boolean } }) {
  const queryClient = useQueryClient();

  const starMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/scans/${id}/star`, { method: 'POST' }).then(r => r.json()),
    // Optimistic update — instant UI feedback
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['scans'] });
      const previous = queryClient.getQueryData(['scans']);
      queryClient.setQueryData(['scans'], (old: any[]) =>
        old.map(s => s.id === id ? { ...s, starred: !s.starred } : s)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      queryClient.setQueryData(['scans'], context?.previous); // rollback
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] }); // refetch truth
    },
  });

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-zinc-800 rounded-lg">
      <span className="text-zinc-100">{scan.name}</span>
      <button onClick={() => starMutation.mutate(scan.id)}
        className={`text-lg ${scan.starred ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
        {scan.starred ? '★' : '☆'}
      </button>
    </div>
  );
}
```

### Infinite Scroll with useInfiniteQuery
```tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';

function InfiniteList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['logs'],
    queryFn: ({ pageParam = 0 }) =>
      fetch(`/api/logs?offset=${pageParam}&limit=20`).then(r => r.json()),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.flat().length : undefined,
  });

  // Intersection Observer for auto-load
  const observer = useRef<IntersectionObserver>();
  const lastRef = useCallback((node: HTMLDivElement | null) => {
    if (isFetchingNextPage) return;
    observer.current?.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasNextPage) fetchNextPage();
    });
    if (node) observer.current.observe(node);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const items = data?.pages.flat() ?? [];

  return (
    <div className="space-y-2 bg-zinc-900 p-4 rounded-xl max-h-[600px] overflow-y-auto">
      {items.map((item: any, i: number) => (
        <div key={item.id} ref={i === items.length - 1 ? lastRef : undefined}
          className="px-4 py-2 bg-zinc-800 rounded-lg text-zinc-300 text-sm">
          {item.message}
        </div>
      ))}
      {isFetchingNextPage && <div className="text-center text-zinc-500 py-2">Loading more...</div>}
    </div>
  );
}
```

### Prefetching
```tsx
// Prefetch on hover — data ready before navigation
function ScanLink({ id, name }: { id: string; name: string }) {
  const queryClient = useQueryClient();

  const prefetch = () => {
    queryClient.prefetchQuery({
      queryKey: ['scan', id],
      queryFn: () => fetch(`/api/scans/${id}`).then(r => r.json()),
      staleTime: 60_000,
    });
  };

  return (
    <a href={`/scans/${id}`} onMouseEnter={prefetch}
      className="text-indigo-400 hover:text-indigo-300 underline">
      {name}
    </a>
  );
}
```

## React Router v7

### createBrowserRouter with Loaders
```tsx
import {
  createBrowserRouter, RouterProvider, Outlet, Navigate,
  useNavigate, useParams, useSearchParams, useRouteError, Link,
} from 'react-router';

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: 'dashboard',
        element: <Dashboard />,
        loader: () => fetch('/api/stats').then(r => r.json()),
      },
      {
        path: 'scans',
        element: <Outlet />,
        children: [
          { index: true, element: <ScanList />, loader: scanListLoader },
          { path: ':scanId', element: <ScanDetail />, loader: scanDetailLoader, errorElement: <ScanError /> },
        ],
      },
      {
        path: 'settings',
        element: <ProtectedRoute><Settings /></ProtectedRoute>,
        action: settingsAction,
      },
    ],
  },
  { path: '/login', element: <LoginPage /> },
]);

function App() {
  return <RouterProvider router={router} />;
}
```

### Root Layout with Outlet
```tsx
import { Outlet, useNavigation, Link, NavLink } from 'react-router';

function RootLayout() {
  const navigation = useNavigation();
  const isLoading = navigation.state === 'loading';

  return (
    <div className="flex h-screen bg-zinc-950">
      <aside className="w-64 shrink-0 bg-zinc-900 border-r border-zinc-700 p-4">
        <nav className="space-y-1">
          {[['Dashboard', '/dashboard'], ['Scans', '/scans'], ['Settings', '/settings']].map(([label, to]) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `block px-4 py-2 rounded-lg text-sm transition-colors
                 ${isActive ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`
              }>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {isLoading && <div className="h-1 bg-indigo-600 animate-pulse" />}
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

### Protected Route with Redirect
```tsx
import { Navigate, useLocation } from 'react-router';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useStore(s => s.user);
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

// After login, redirect back to original page
function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const from = (location.state as any)?.from ?? '/dashboard';

  const handleLogin = async () => {
    await performLogin();
    navigate(from, { replace: true });
  };
  // ...
}
```

### Loaders, Actions, and useSearchParams
```tsx
import { useLoaderData, useSearchParams } from 'react-router';

// Loader runs before render — parallel data fetching
async function scanListLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const page = url.searchParams.get('page') ?? '1';
  const res = await fetch(`/api/scans?page=${page}`);
  if (!res.ok) throw new Response('Failed to load', { status: res.status });
  return res.json();
}

function ScanList() {
  const data = useLoaderData() as { scans: any[]; total: number };
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);

  return (
    <div className="space-y-4">
      {data.scans.map(s => <ScanCard key={s.id} scan={s} />)}
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}
          className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 disabled:opacity-40">Prev</button>
        <button onClick={() => setParams({ page: String(page + 1) })}
          className="px-3 py-1 rounded bg-zinc-800 text-zinc-300">Next</button>
      </div>
    </div>
  );
}

// Action handles form mutations (POST/PUT/DELETE)
async function settingsAction({ request }: { request: Request }) {
  const fd = await request.formData();
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(fd)),
  });
  if (!res.ok) return { error: 'Save failed' };
  return { success: true };
}
```

## Accessibility (a11y)

### Semantic HTML + ARIA
```tsx
// Prefer semantic elements over divs. Use ARIA only when HTML semantics are insufficient.
function ScanResultCard({ scan }: { scan: { id: string; status: string; findings: number } }) {
  return (
    <article aria-labelledby={`scan-${scan.id}`}
      className="rounded-xl bg-zinc-900 border border-zinc-700 p-4">
      <h3 id={`scan-${scan.id}`} className="text-zinc-100 font-semibold">{scan.id}</h3>
      <p className="text-zinc-400 text-sm">
        Status: <span aria-label={`Status is ${scan.status}`}
          className="text-emerald-400 font-medium">{scan.status}</span>
      </p>
      <p aria-describedby={`findings-help-${scan.id}`} className="text-zinc-300 mt-2">
        {scan.findings} findings
      </p>
      <span id={`findings-help-${scan.id}`} className="sr-only">
        Number of security issues found in this scan
      </span>
    </article>
  );
}
```

### Keyboard Navigation + Focus Management
```tsx
import { useRef, useEffect } from 'react';

function CommandPalette({ open, onClose, items, onSelect }: {
  open: boolean; onClose: () => void;
  items: { id: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  // Focus trap — auto-focus input on open
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive(i => Math.max(i - 1, 0)); break;
      case 'Enter': onSelect(items[active].id); onClose(); break;
      case 'Escape': onClose(); break;
    }
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60"
      onClick={onClose}>
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input ref={inputRef} placeholder="Search commands..." aria-autocomplete="list"
          aria-controls="cmd-list" aria-activedescendant={`cmd-${items[active]?.id}`}
          className="w-full px-4 py-3 bg-transparent text-zinc-100 border-b border-zinc-700 focus:outline-none" />
        <ul id="cmd-list" role="listbox" className="max-h-64 overflow-y-auto py-1">
          {items.map((item, i) => (
            <li key={item.id} id={`cmd-${item.id}`} role="option" aria-selected={i === active}
              tabIndex={-1}
              onClick={() => { onSelect(item.id); onClose(); }}
              className={`px-4 py-2 cursor-pointer text-sm
                ${i === active ? 'bg-indigo-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}>
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

### Screen Reader Announcements + Skip Link
```tsx
// Live region for dynamic updates — screen readers announce changes
function ScanProgress({ percent }: { percent: number }) {
  return (
    <div>
      <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-600 transition-all duration-300"
          style={{ width: `${percent}%` }}
          role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} />
      </div>
      <p aria-live="polite" className="sr-only">{percent}% complete</p>
    </div>
  );
}

// Skip link — first element in body, visible on focus
function SkipLink() {
  return (
    <a href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100]
        focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
      Skip to main content
    </a>
  );
}

// Color contrast: WCAG AA requires 4.5:1 for text, 3:1 for large text.
// zinc-400 on zinc-900 = ~5.5:1 (passes). zinc-500 on zinc-900 = ~3.9:1 (fails for small text).
// Always use zinc-400 or lighter for body text on dark backgrounds.
```

## Error Boundaries

### Generic Error Boundary Component
```tsx
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}
interface State { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info);
    // Send to error tracking: Sentry.captureException(error, { extra: info });
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <ErrorFallback error={this.state.error!} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}
```

### Fallback UI with Retry
```tsx
function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-4 p-12 bg-zinc-900 rounded-xl border border-zinc-700">
      <div className="w-12 h-12 rounded-full bg-red-600/20 flex items-center justify-center">
        <span className="text-red-400 text-2xl">!</span>
      </div>
      <h2 className="text-zinc-100 text-lg font-semibold">Something went wrong</h2>
      <p className="text-zinc-400 text-sm text-center max-w-md">{error.message}</p>
      <button onClick={onRetry}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors">
        Try Again
      </button>
    </div>
  );
}
```

### Suspense + Error Boundary Composition
```tsx
import { Suspense } from 'react';

// Per-route boundaries: isolate failures so one broken section doesn't crash the page
function DashboardPage() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
      <ErrorBoundary fallback={<WidgetError name="Metrics" />}>
        <Suspense fallback={<WidgetSkeleton />}>
          <MetricsWidget />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary fallback={<WidgetError name="Activity" />}>
        <Suspense fallback={<WidgetSkeleton />}>
          <ActivityWidget />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function WidgetSkeleton() {
  return <div className="animate-pulse bg-zinc-800 rounded-xl h-64" />;
}

function WidgetError({ name }: { name: string }) {
  return (
    <div className="bg-zinc-900 border border-red-800/50 rounded-xl p-6 text-center">
      <p className="text-zinc-400 text-sm">Failed to load {name}</p>
    </div>
  );
}

// Global boundary at app root — catches anything not caught by route-level boundaries
function AppRoot() {
  return (
    <ErrorBoundary onError={(e) => console.error('Uncaught:', e)}>
      <App />
    </ErrorBoundary>
  );
}
```

## Performance Optimization

### React.memo + useMemo/useCallback
```tsx
import { memo, useMemo, useCallback } from 'react';

// React.memo — skip re-render if props are shallow-equal
const ExpensiveRow = memo(function ExpensiveRow({ item, onDelete }: {
  item: { id: string; name: string; score: number };
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-zinc-800 rounded-lg">
      <span className="text-zinc-100">{item.name}</span>
      <span className="text-zinc-400">{item.score}</span>
      <button onClick={() => onDelete(item.id)} className="text-red-400 text-sm hover:text-red-300">Delete</button>
    </div>
  );
});

function ItemList({ items }: { items: { id: string; name: string; score: number }[] }) {
  // useCallback — stable reference so memo'd children don't re-render
  const handleDelete = useCallback((id: string) => {
    // delete logic
  }, []);

  // useMemo — expensive derived data computed only when deps change
  const sorted = useMemo(() =>
    [...items].sort((a, b) => b.score - a.score),
    [items]
  );

  return (
    <div className="space-y-2">
      {sorted.map(item => <ExpensiveRow key={item.id} item={item} onDelete={handleDelete} />)}
    </div>
  );
}
```

### Lazy Loading + Code Splitting
```tsx
import { lazy, Suspense } from 'react';

// Split heavy pages/components into separate chunks
const ScanDashboard = lazy(() => import('./pages/ScanDashboard'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const ChartWidget = lazy(() => import('./components/ChartWidget'));

function App() {
  return (
    <Suspense fallback={<FullPageSkeleton />}>
      <Routes>
        <Route path="/scans" element={<ScanDashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Suspense>
  );
}

function FullPageSkeleton() {
  return (
    <div className="flex h-screen bg-zinc-950">
      <div className="w-64 bg-zinc-900 animate-pulse" />
      <div className="flex-1 p-6 space-y-4">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-64 bg-zinc-800 rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
```

### Virtual Scrolling (TanStack Virtual)
```tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

function VirtualList({ items }: { items: { id: string; text: string }[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // estimated row height in px
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-y-auto bg-zinc-900 rounded-xl border border-zinc-700">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vRow => (
          <div key={vRow.key}
            style={{ position: 'absolute', top: 0, transform: `translateY(${vRow.start}px)`, width: '100%', height: `${vRow.size}px` }}
            className="flex items-center px-4 border-b border-zinc-800 text-zinc-300 text-sm">
            {items[vRow.index].text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Image Optimization
```tsx
// Native lazy loading + responsive images
function OptimizedImage({ src, alt, widths = [320, 640, 1024] }: {
  src: string; alt: string; widths?: number[];
}) {
  const srcSet = widths.map(w => `${src}?w=${w} ${w}w`).join(', ');

  return (
    <img
      src={`${src}?w=${widths[1]}`}
      srcSet={srcSet}
      sizes="(max-width: 640px) 320px, (max-width: 1024px) 640px, 1024px"
      alt={alt}
      loading="lazy"
      decoding="async"
      className="rounded-lg bg-zinc-800 object-cover"
    />
  );
}
```

## Form Libraries (React Hook Form + Zod)

### Basic Form with Zod Validation
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'editor', 'viewer'], { message: 'Select a role' }),
  bio: z.string().max(500).optional(),
});
type FormData = z.infer<typeof schema>;

function UserForm({ onSubmit }: { onSubmit: (data: FormData) => Promise<void> }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'viewer' },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 bg-zinc-900 p-6 rounded-xl">
      <Field label="Name" error={errors.name?.message}>
        <input {...register('name')}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
      </Field>

      <Field label="Email" error={errors.email?.message}>
        <input {...register('email')} type="email"
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
      </Field>

      <Field label="Role" error={errors.role?.message}>
        <select {...register('role')}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </Field>

      <Field label="Bio (optional)" error={errors.bio?.message}>
        <textarea {...register('bio')} rows={3}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none" />
      </Field>

      <button type="submit" disabled={isSubmitting}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors">
        {isSubmitting ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-zinc-400 mb-1">{label}</label>
      {children}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
```

### Field Arrays (Dynamic Rows)
```tsx
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const envSchema = z.object({
  vars: z.array(z.object({
    key: z.string().min(1, 'Required'),
    value: z.string().min(1, 'Required'),
    secret: z.boolean(),
  })).min(1, 'Add at least one variable'),
});
type EnvFormData = z.infer<typeof envSchema>;

function EnvVarForm() {
  const { register, control, handleSubmit, formState: { errors } } = useForm<EnvFormData>({
    resolver: zodResolver(envSchema),
    defaultValues: { vars: [{ key: '', value: '', secret: false }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'vars' });

  return (
    <form onSubmit={handleSubmit(console.log)} className="space-y-3 bg-zinc-900 p-6 rounded-xl">
      {fields.map((field, index) => (
        <div key={field.id} className="flex gap-2 items-start">
          <input {...register(`vars.${index}.key`)} placeholder="KEY"
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
          <input {...register(`vars.${index}.value`)} placeholder="value"
            type={field.secret ? 'password' : 'text'}
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
          <label className="flex items-center gap-1 text-zinc-400 text-xs whitespace-nowrap">
            <input type="checkbox" {...register(`vars.${index}.secret`)} className="accent-indigo-600" />
            Secret
          </label>
          <button type="button" onClick={() => remove(index)}
            className="text-red-400 hover:text-red-300 px-2 py-2 text-sm">X</button>
        </div>
      ))}
      <button type="button" onClick={() => append({ key: '', value: '', secret: false })}
        className="text-indigo-400 hover:text-indigo-300 text-sm">+ Add variable</button>
      <button type="submit"
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 transition-colors mt-4">
        Save Variables
      </button>
    </form>
  );
}
```

### Multi-Step Form
```tsx
import { useForm, FormProvider, useFormContext } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const wizardSchema = z.object({
  // Step 1
  name: z.string().min(2),
  email: z.string().email(),
  // Step 2
  plan: z.enum(['free', 'pro', 'enterprise']),
  // Step 3
  agreeTerms: z.literal(true, { errorMap: () => ({ message: 'You must agree' }) }),
});
type WizardData = z.infer<typeof wizardSchema>;

function WizardForm() {
  const [step, setStep] = useState(0);
  const methods = useForm<WizardData>({ resolver: zodResolver(wizardSchema), mode: 'onTouched' });

  // Validate only current step's fields before advancing
  const stepsFields: (keyof WizardData)[][] = [['name', 'email'], ['plan'], ['agreeTerms']];
  const next = async () => {
    const valid = await methods.trigger(stepsFields[step]);
    if (valid) setStep(s => s + 1);
  };

  const steps = [<StepAccount />, <StepPlan />, <StepConfirm />];

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(console.log)}
        className="bg-zinc-900 p-6 rounded-xl max-w-md mx-auto space-y-6">
        {/* Progress indicator */}
        <div className="flex gap-2">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors
              ${i <= step ? 'bg-indigo-600' : 'bg-zinc-700'}`} />
          ))}
        </div>

        {steps[step]}

        <div className="flex justify-between">
          {step > 0 && (
            <button type="button" onClick={() => setStep(s => s - 1)}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-sm">Back</button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" onClick={next}
              className="ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm">
              Next
            </button>
          ) : (
            <button type="submit"
              className="ml-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm">
              Submit
            </button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}

function StepAccount() {
  const { register, formState: { errors } } = useFormContext<WizardData>();
  return (
    <div className="space-y-3">
      <h3 className="text-zinc-100 font-semibold">Account Info</h3>
      <input {...register('name')} placeholder="Name"
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
      {errors.name && <p className="text-red-400 text-xs">{errors.name.message}</p>}
      <input {...register('email')} placeholder="Email"
        className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
      {errors.email && <p className="text-red-400 text-xs">{errors.email.message}</p>}
    </div>
  );
}
```

### File Upload with Validation
```tsx
const uploadSchema = z.object({
  file: z
    .instanceof(FileList)
    .refine(f => f.length === 1, 'File is required')
    .refine(f => f[0]?.size <= 5_000_000, 'Max 5MB')
    .refine(f => ['image/png', 'image/jpeg'].includes(f[0]?.type), 'PNG or JPEG only'),
});

function FileUpload() {
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    resolver: zodResolver(uploadSchema),
  });
  const file = watch('file');
  const preview = file?.[0] ? URL.createObjectURL(file[0]) : null;

  return (
    <form onSubmit={handleSubmit(async (data) => {
      const fd = new FormData();
      fd.append('file', data.file[0]);
      await fetch('/api/upload', { method: 'POST', body: fd });
    })} className="space-y-4 bg-zinc-900 p-6 rounded-xl">
      <label className="flex flex-col items-center gap-2 border-2 border-dashed border-zinc-600 rounded-xl p-8 cursor-pointer hover:border-indigo-500 transition-colors">
        <span className="text-zinc-400 text-sm">Drop file or click to upload</span>
        <input {...register('file')} type="file" accept="image/png,image/jpeg" className="hidden" />
      </label>
      {preview && <img src={preview} alt="Preview" className="w-32 h-32 rounded-lg object-cover bg-zinc-800" />}
      {errors.file && <p className="text-red-400 text-xs">{errors.file.message as string}</p>}
      <button type="submit"
        className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 transition-colors">
        Upload
      </button>
    </form>
  );
}
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

### Area Chart
```tsx
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function TrafficChart({ data }: { data: { date: string; visits: number; uniques: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="grad-visits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="grad-uniques" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
        <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} />
        <YAxis stroke="#a1a1aa" fontSize={12} />
        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#e4e4e7' }} />
        <Area type="monotone" dataKey="visits" stroke="#6366f1" fill="url(#grad-visits)" strokeWidth={2} />
        <Area type="monotone" dataKey="uniques" stroke="#10b981" fill="url(#grad-uniques)" strokeWidth={2} />
      </AreaChart>
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

### Pie / Donut Chart
```tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function SeverityDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
          dataKey="value" paddingAngle={3} stroke="none">
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Pie>
        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#e4e4e7' }} />
        <Legend verticalAlign="bottom" iconType="circle"
          formatter={(value) => <span className="text-zinc-400 text-sm">{value}</span>} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Usage:
// <SeverityDonut data={[
//   { name: 'Critical', value: 5, color: '#ef4444' },
//   { name: 'High', value: 12, color: '#f97316' },
//   { name: 'Medium', value: 28, color: '#eab308' },
//   { name: 'Low', value: 45, color: '#22c55e' },
// ]} />
```

### Sparkline (Inline Mini Chart)
```tsx
import { LineChart, Line, ResponsiveContainer } from 'recharts';

function Sparkline({ data, color = '#6366f1', height = 32 }: {
  data: { value: number }[];
  color?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
          dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Stat card with sparkline
function StatCard({ label, value, trend, sparkData }: {
  label: string; value: string; trend: string; sparkData: { value: number }[];
}) {
  const isPositive = trend.startsWith('+');
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-700 p-4">
      <p className="text-sm text-zinc-400">{label}</p>
      <div className="flex items-end justify-between mt-1">
        <p className="text-2xl font-bold text-zinc-100">{value}</p>
        <div className="w-24"><Sparkline data={sparkData} color={isPositive ? '#10b981' : '#ef4444'} /></div>
      </div>
      <p className={`text-sm mt-2 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{trend}</p>
    </div>
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const id = setInterval(() => {
    res.write(`data: ${JSON.stringify({ ts: Date.now(), metrics: getMetrics() })}\n\n`);
  }, 2000);
  req.on('close', () => clearInterval(id));
});
```

### Connection Status Indicator
```tsx
function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full
      ${connected ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
      {connected ? 'Live' : 'Disconnected'}
    </span>
  );
}
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
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  );
}
```

### Staggered Children
```tsx
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

function StaggerGrid({ items }: { items: { id: string; title: string }[] }) {
  return (
    <motion.div variants={containerVariants} initial="hidden" animate="show"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {items.map(item => (
        <motion.div key={item.id} variants={itemVariants}
          className="rounded-xl bg-zinc-900 border border-zinc-700 p-4 text-zinc-100">
          {item.title}
        </motion.div>
      ))}
    </motion.div>
  );
}
```
