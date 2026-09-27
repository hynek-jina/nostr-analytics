import type { Event, Filter, SimplePool } from "nostr-tools";
import { verifyEvent } from "nostr-tools";
import { unwrapEvent } from "nostr-tools/nip17";
import {
  isGiftWrapAddressedToPubkey,
  parsePaymentTelemetryContent,
  PAYMENT_TELEMETRY_KIND,
  type PaymentTelemetryEvent,
} from "./telemetry";

const GIFT_WRAP_KIND = 1059;
const RELAY_LIST_KIND = 10002;
const DM_RELAY_LIST_KIND = 10050;
// Linky clients write gift wraps to their own write relays. Since Linky
// 26.9.11 every installation writes to nostr.linky.fit as well, and the big
// public relays no longer keep kind 1059 for this account, so the Linky relay
// is where the telemetry actually lives.
const DEFAULT_RELAYS = [
  "wss://nostr.linky.fit",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.0xchat.com",
];
const DEFAULT_LOOKBACK_DAYS = 45;
const PAGE_LIMIT = 500;
const MAX_PAGE_LIMIT = 8000;
const MAX_PAGES_PER_RELAY = 40;
const PAGE_MAX_WAIT_MS = 12000;

type AppNostrPool = Pick<SimplePool, "querySync">;

interface NostrEventLike {
  content: string;
  id: string;
  kind: number;
  pubkey: string;
  tags: string[][];
}

export interface RelayFetchResult {
  /** Null when the relay answered every page before the lookback window. */
  error: string | null;
  url: string;
  wrapCount: number;
}

export interface FetchTelemetryResult {
  fetchedWrapCount: number;
  ignoredWrapCount: number;
  relayResults: RelayFetchResult[];
  relayUrls: string[];
  telemetryEvents: PaymentTelemetryEvent[];
}

export interface AccountProfile {
  imageUrl: string | null;
  name: string | null;
}

let sharedPoolPromise: Promise<AppNostrPool> | null = null;

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isStringArrayArray = (value: unknown): value is string[][] => {
  if (!Array.isArray(value)) return false;

  return value.every((entry) => {
    return (
      Array.isArray(entry) && entry.every((item) => typeof item === "string")
    );
  });
};

const isNostrEventLike = (value: unknown): value is NostrEventLike => {
  if (!isObjectRecord(value)) return false;

  const id = Reflect.get(value, "id");
  const pubkey = Reflect.get(value, "pubkey");
  const kind = Reflect.get(value, "kind");
  const content = Reflect.get(value, "content");
  const tags = Reflect.get(value, "tags");

  return (
    typeof id === "string" &&
    typeof pubkey === "string" &&
    typeof kind === "number" &&
    typeof content === "string" &&
    isStringArrayArray(tags)
  );
};

const normalizeRelayUrls = (relayUrls: readonly string[]): string[] => {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const relayUrl of relayUrls) {
    let normalized: string;
    try {
      const url = new URL(String(relayUrl).trim());
      if (url.protocol !== "wss:") continue;
      if (url.username || url.password || url.hash) continue;
      normalized = url.toString().replace(/\/$/, "");
    } catch {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
};

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getSharedPool = async (): Promise<AppNostrPool> => {
  if (sharedPoolPromise) return sharedPoolPromise;

  sharedPoolPromise = (async () => {
    const { SimplePool } = await import("nostr-tools");
    return new SimplePool();
  })().catch((error) => {
    sharedPoolPromise = null;
    throw error;
  });

  return sharedPoolPromise;
};

const newestEvent = (events: readonly Event[]): Event | undefined =>
  events
    .slice()
    .sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0))[0];

/**
 * Default relays plus whatever the collector advertises: NIP-17 inbox relays
 * (kind 10050) and the read side of its NIP-65 list (kind 10002).
 */
const loadRelayListForPubkey = async (
  publicKeyHex: string,
): Promise<string[]> => {
  const pool = await getSharedPool();
  const listEvents = await pool.querySync(
    DEFAULT_RELAYS,
    {
      authors: [publicKeyHex],
      kinds: [RELAY_LIST_KIND, DM_RELAY_LIST_KIND],
      limit: 10,
    },
    { maxWait: 5000 },
  );

  const verified = listEvents.filter(
    (event) => event.pubkey === publicKeyHex && verifyEvent(event),
  );
  const inbox = newestEvent(
    verified.filter((event) => event.kind === DM_RELAY_LIST_KIND),
  );
  const general = newestEvent(
    verified.filter((event) => event.kind === RELAY_LIST_KIND),
  );

  const inboxRelays =
    inbox?.tags
      .filter((tag) => tag[0] === "relay" && Boolean(tag[1]))
      .map((tag) => String(tag[1])) ?? [];
  const readRelays =
    general?.tags
      .filter((tag) => tag[0] === "r" && Boolean(tag[1]) && tag[2] !== "write")
      .map((tag) => String(tag[1])) ?? [];

  const normalized = normalizeRelayUrls([
    ...DEFAULT_RELAYS,
    ...inboxRelays,
    ...readRelays,
  ]);
  return normalized.length > 0 ? normalized : DEFAULT_RELAYS;
};

export const fetchAccountProfile = async (args: {
  publicKeyHex: string;
  relayUrls?: readonly string[];
}): Promise<AccountProfile> => {
  const relayUrls =
    args.relayUrls && args.relayUrls.length > 0
      ? normalizeRelayUrls(args.relayUrls)
      : await loadRelayListForPubkey(args.publicKeyHex);
  const pool = await getSharedPool();
  const profileEvents = await pool.querySync(
    relayUrls,
    { authors: [args.publicKeyHex], kinds: [0], limit: 5 },
    { maxWait: 5000 },
  );

  const newest = newestEvent(profileEvents);

  if (!newest) {
    return { imageUrl: null, name: null };
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(newest.content);
  } catch {
    return { imageUrl: null, name: null };
  }

  if (!isObjectRecord(parsed)) {
    return { imageUrl: null, name: null };
  }

  const displayName = asTrimmedString(Reflect.get(parsed, "display_name"));
  const fallbackName = asTrimmedString(Reflect.get(parsed, "name"));
  const picture = asTrimmedString(Reflect.get(parsed, "picture"));
  const image = asTrimmedString(Reflect.get(parsed, "image"));

  return {
    imageUrl: picture ?? image,
    name: displayName ?? fallbackName,
  };
};

/**
 * Pages backwards through one relay with `until` so a relay's per-query cap
 * (often 500) cannot silently truncate the window. Duplicate ids at the page
 * boundary are dropped; when a whole page shares one timestamp the limit grows.
 */
const fetchWrapsFromRelay = async (
  pool: AppNostrPool,
  relayUrl: string,
  publicKeyHex: string,
  since: number,
): Promise<{ error: string | null; wraps: Event[] }> => {
  const wrapsById = new Map<string, Event>();
  let until: number | undefined;
  let limit = PAGE_LIMIT;

  for (let page = 0; page < MAX_PAGES_PER_RELAY; page += 1) {
    const filter: Filter = { kinds: [GIFT_WRAP_KIND], limit, since };
    filter["#p"] = [publicKeyHex];
    if (until !== undefined) filter.until = until;

    let events: Event[];
    try {
      events = await pool.querySync([relayUrl], filter, {
        maxWait: PAGE_MAX_WAIT_MS,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Relay query failed.",
        wraps: Array.from(wrapsById.values()),
      };
    }

    let fresh = 0;
    for (const event of events) {
      if (wrapsById.has(event.id)) continue;
      wrapsById.set(event.id, event);
      fresh += 1;
    }

    if (events.length < limit || fresh === 0) {
      return { error: null, wraps: Array.from(wrapsById.values()) };
    }

    const oldest = Math.min(...events.map((event) => event.created_at));
    if (oldest <= since) {
      return { error: null, wraps: Array.from(wrapsById.values()) };
    }
    if (oldest === until) {
      if (limit >= MAX_PAGE_LIMIT) {
        return {
          error:
            "Too many wraps share one timestamp; history may be incomplete.",
          wraps: Array.from(wrapsById.values()),
        };
      }
      limit *= 2;
    } else {
      until = oldest;
      limit = PAGE_LIMIT;
    }
  }

  return {
    error: "Stopped after the page limit; history may be incomplete.",
    wraps: Array.from(wrapsById.values()),
  };
};

export const fetchTelemetryForCollector = async (args: {
  lookbackDays?: number;
  privateKeyBytes: Uint8Array;
  publicKeyHex: string;
}): Promise<FetchTelemetryResult> => {
  const lookbackDays = args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const relayUrls = await loadRelayListForPubkey(args.publicKeyHex);
  const pool = await getSharedPool();
  const since = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  const perRelay = await Promise.all(
    relayUrls.map(async (relayUrl) => ({
      relayUrl,
      ...(await fetchWrapsFromRelay(pool, relayUrl, args.publicKeyHex, since)),
    })),
  );

  const wrapsById = new Map<string, Event>();
  const relayResults: RelayFetchResult[] = [];
  for (const result of perRelay) {
    relayResults.push({
      error: result.error,
      url: result.relayUrl,
      wrapCount: result.wraps.length,
    });
    for (const wrap of result.wraps) {
      if (!wrapsById.has(wrap.id)) wrapsById.set(wrap.id, wrap);
    }
  }

  const telemetryById = new Map<string, PaymentTelemetryEvent>();
  let ignoredWrapCount = 0;

  for (const wrap of wrapsById.values()) {
    if (!verifyEvent(wrap)) {
      ignoredWrapCount += 1;
      continue;
    }

    let unwrapped: unknown = null;

    try {
      unwrapped = unwrapEvent(wrap, args.privateKeyBytes);
    } catch {
      ignoredWrapCount += 1;
      continue;
    }

    if (!isNostrEventLike(unwrapped)) {
      ignoredWrapCount += 1;
      continue;
    }

    if (unwrapped.kind !== PAYMENT_TELEMETRY_KIND) {
      ignoredWrapCount += 1;
      continue;
    }

    if (!isGiftWrapAddressedToPubkey(unwrapped.tags, args.publicKeyHex)) {
      ignoredWrapCount += 1;
      continue;
    }

    const payload = parsePaymentTelemetryContent(unwrapped.content);
    if (!payload) {
      ignoredWrapCount += 1;
      continue;
    }

    const existing = telemetryById.get(payload.id);
    if (existing && existing.createdAtSec >= payload.createdAtSec) {
      continue;
    }

    telemetryById.set(payload.id, {
      ...payload,
      senderPubkey: unwrapped.pubkey,
      wrapId: wrap.id,
    });
  }

  const telemetryEvents = Array.from(telemetryById.values()).sort(
    (left, right) => right.createdAtSec - left.createdAtSec,
  );

  return {
    fetchedWrapCount: wrapsById.size,
    ignoredWrapCount,
    relayResults,
    relayUrls,
    telemetryEvents,
  };
};
