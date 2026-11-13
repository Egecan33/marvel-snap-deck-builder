'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getStatus, type StatusResponse } from '../lib/api';
import { errText, fmtInt, isAbort } from '../lib/ui';

// Messages: API errors stay until dismissed, confirmations go after 4 s.
interface Message { id: number; kind: 'error' | 'info'; text: string }
interface Notify { error: (e: unknown) => void; info: (text: string) => void }
const NotifyContext = createContext<Notify>({ error: () => {}, info: () => {} });
export const useNotify = (): Notify => useContext(NotifyContext);

// Database status, shared by the nav, the first-run redirect, image placeholders and the Data page.
interface StatusValue { status: StatusResponse | null; refresh: () => Promise<StatusResponse | null>; noArt: ReadonlySet<string> }
const StatusContext = createContext<StatusValue>({ status: null, refresh: async () => null, noArt: new Set() });
export const useStatus = (): StatusValue => useContext(StatusContext);

const NAV = [
  { href: '/', label: 'Decks' },
  { href: '/new', label: 'Brew' },
  { href: '/discover', label: 'Discover' },
  { href: '/collection', label: 'Collection' },
  { href: '/data', label: 'Data' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setMessages((m) => m.filter((x) => x.id !== id)), []);
  const notify = useMemo<Notify>(() => {
    const push = (kind: Message['kind'], text: string) => {
      const id = nextId.current++;
      setMessages((m) => (m.some((x) => x.text === text && x.kind === kind) ? m : [...m.slice(-4), { id, kind, text }]));
      if (kind === 'info') setTimeout(() => dismiss(id), 4000);
    };
    return { error: (e) => !isAbort(e) && push('error', errText(e)), info: (t) => push('info', t) };
  }, [dismiss]);

  const refresh = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
      return s;
    } catch (e) {
      notify.error(`Could not read the database status: ${errText(e)}`);
      return null;
    }
  }, [notify]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // First run: nothing works without cards, so every page leads to Data.
  const empty = status?.empty === true;
  useEffect(() => {
    if (empty && pathname !== '/data') router.replace('/data');
  }, [empty, pathname, router]);

  const noArt = useMemo(() => {
    const list = status?.sync.images?.info.noArt;
    return new Set(Array.isArray(list) ? (list as string[]) : []);
  }, [status]);
  const value = useMemo(() => ({ status, refresh, noArt }), [status, refresh, noArt]);
  const meta = status?.meta;

  return (
    <NotifyContext.Provider value={notify}>
      <StatusContext.Provider value={value}>
        <div className="flex h-screen min-w-[1180px] flex-col">
          <header className="flex h-12 shrink-0 items-center gap-8 border-b border-line bg-panel px-5">
            <Link href="/" className="display flex items-baseline gap-1 text-[1.35rem] leading-none">
              <span>Snap</span>
              <span className="text-nov-brew">Forge</span>
            </Link>
            <nav className="flex h-full items-stretch gap-1" aria-label="Main">
              {NAV.map((n) => {
                const on = n.href === '/' ? pathname === '/' || pathname.startsWith('/deck/') : pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={`flex items-center border-b-2 px-2.5 text-[0.9rem] ${on ? 'border-nov-brew text-text' : 'border-transparent text-muted hover:text-text'}`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto text-right text-[0.78rem] leading-tight text-faint" data-testid="nav-status">
              {status && !status.empty && (
                <>
                  {fmtInt(status.counts.released)} released cards
                  {meta ? `, meta ${meta.periodLabel ?? 'snapshot'}: ${fmtInt(meta.lists)} lists` : ', no meta synced'}
                </>
              )}
              {status?.empty && 'No card data yet'}
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto thin-scroll">{empty && pathname !== '/data' ? null : children}</main>
        </div>

        <div className="pointer-events-none fixed bottom-4 left-4 z-[80] flex w-[26rem] flex-col gap-2" aria-live="polite">
          {messages.map((m) => (
            <div
              key={m.id}
              role={m.kind === 'error' ? 'alert' : 'status'}
              data-testid={m.kind === 'error' ? 'error-message' : 'info-message'}
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[0.875rem] shadow-xl ${
                m.kind === 'error' ? 'border-r-low bg-[#3a1626]' : 'border-line bg-raised'
              }`}
            >
              <span className="min-w-0 flex-1 break-words">{m.text}</span>
              <button type="button" className="shrink-0 text-muted hover:text-text" onClick={() => dismiss(m.id)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      </StatusContext.Provider>
    </NotifyContext.Provider>
  );
}
