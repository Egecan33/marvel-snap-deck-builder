/*
 * Typed client for the Snap Forge API (plan Task 10; shapes in src/server/api-types.ts).
 * Every route answers JSON; on failure the body is `{ error }` and the functions below throw
 * `ApiError` with that message.
 */
import type { BuildOutcome, Deck, Prompts, SwapProposal } from '@/engine/types';
import type {
  AnalyzeResponse, CardDetail, CardFilters, CardView, CardsResponse, CollectionSummary, DeckResponse, DeckTile, ExportResponse,
  GemsResponse, ImportResponse, ScoredCard, Settings, StatusResponse,
} from '@/server/api-types';

export type { AnalyzeResponse, CardDetail, CardFilters, CardView, CardsResponse, CollectionSummary, DeckTile, GemsResponse, Settings, StatusResponse };
export type Lookup = Record<string, CardView>;
export type ScoredCardView = ScoredCard;

export type SyncStep = 'cards' | 'locations' | 'meta' | 'features' | 'images';
export interface SyncState {
  running: boolean; step: SyncStep | 'all' | null; startedAt: string | null; finishedAt: string | null;
  exitCode: number | null; lineCount: number; lines: string[];
}

export type CardSort = 'score' | 'cost' | 'power' | 'name' | 'playRate';
export interface CardsRequest { deck: Deck; q?: string; filters?: CardFilters; sort?: CardSort; page?: number; pageSize?: number }

export interface BuildRequestOptions { mode?: 'brew' | 'tuned'; seed?: number; count?: number; ownedOnly?: boolean; prompts?: Partial<Prompts> }
export type BuildResponse = BuildOutcome & { cards: Lookup };
export interface ImproveResponse { swaps: SwapProposal[]; deck: Deck; cards: Lookup }

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Card art from data/images through the image route (an SVG card back when the file is missing). */
export const imageUrl = (defId: string): string => `/api/img/${encodeURIComponent(defId)}.webp`;

async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // reported through the status below
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === 'string' ? message : `${method} ${url} failed (${res.status})`, res.status);
  }
  // An abort while the body was being read leaves no data: report it as the abort it is, so
  // callers that ignore aborts do not read fields of null (seen in the Task 12 e2e run).
  if (data === null) {
    if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    throw new ApiError(`${method} ${url} returned no data (${res.status})`, res.status);
  }
  return data as T;
}

export const getStatus = (signal?: AbortSignal) => call<StatusResponse>('GET', '/api/status', undefined, signal);
export const getSync = (since = 0, signal?: AbortSignal) => call<SyncState>('GET', `/api/sync?since=${since}`, undefined, signal);
export const startSync = (step: SyncStep | 'all') => call<SyncState>('POST', '/api/sync', { step });

export const listDecks = (signal?: AbortSignal) => call<{ decks: DeckTile[] }>('GET', '/api/decks', undefined, signal);
export const createDeck = (deck: Deck) => call<DeckResponse>('POST', '/api/decks', { deck });
export const getDeck = (id: string, signal?: AbortSignal) => call<DeckResponse>('GET', `/api/decks/${encodeURIComponent(id)}`, undefined, signal);
export const updateDeck = (id: string, deck: Deck) => call<DeckResponse>('PUT', `/api/decks/${encodeURIComponent(id)}`, { deck });
export const deleteDeck = (id: string) => call<{ ok: true }>('DELETE', `/api/decks/${encodeURIComponent(id)}`);

export const analyzeDeck = (deck: Deck, signal?: AbortSignal) => call<AnalyzeResponse>('POST', '/api/analyze', { deck }, signal);
export const browseCards = (req: CardsRequest, signal?: AbortSignal) => call<CardsResponse>('POST', '/api/cards', req, signal);
export const getCard = (id: string, deckIds: string[] | null, signal?: AbortSignal) =>
  call<CardDetail>('GET', `/api/card/${encodeURIComponent(id)}${deckIds && deckIds.length ? `?deck=${encodeURIComponent(deckIds.join(','))}` : ''}`, undefined, signal);

export const buildDecks = (deck: Deck, options: BuildRequestOptions, signal?: AbortSignal) => call<BuildResponse>('POST', '/api/build', { deck, options }, signal);
export const improveDeck = (deck: Deck, direction: 'stronger' | 'more-original', options: BuildRequestOptions = {}, signal?: AbortSignal) =>
  call<ImproveResponse>('POST', '/api/improve', { deck, direction, options }, signal);

export const getGems = (q: string, limit: number, signal?: AbortSignal) =>
  call<GemsResponse>('GET', `/api/gems?q=${encodeURIComponent(q)}&limit=${limit}`, undefined, signal);

export const importDeck = (text: string, format?: string) => call<ImportResponse>('POST', '/api/import', { text, format });
export const exportDeck = (deck: Deck) => call<ExportResponse>('POST', '/api/export', { deck });

export const getCollection = (signal?: AbortSignal) => call<CollectionSummary>('GET', '/api/collection', undefined, signal);
export const importCollection = (text: string, mode: 'add' | 'replace') =>
  call<{ added: number; unresolved: string[]; kind: string; summary: CollectionSummary }>('POST', '/api/collection', { text, mode });
export const setSeries = (series: number, owned: boolean) => call<{ summary: CollectionSummary }>('POST', '/api/collection', { series, owned });
export const clearCollection = () => call<CollectionSummary>('DELETE', '/api/collection');

export const getSettings = (signal?: AbortSignal) => call<{ settings: Settings }>('GET', '/api/settings', undefined, signal);
export const updateSettings = (settings: Partial<Settings>) => call<{ settings: Settings }>('PUT', '/api/settings', { settings });
