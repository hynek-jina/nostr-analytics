import type { Filter, SimplePool } from "nostr-tools";
import { unwrapEvent } from "nostr-tools/nip17";
import {
  isGiftWrapAddressedToPubkey,
  parsePaymentTelemetryContent,
  PAYMENT_TELEMETRY_KIND,
  type PaymentTelemetryEvent,
} from "./telemetry";

const GIFT_WRAP_KIND = 1059;
const RELAY_LIST_KIND = 10002;
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.0xchat.com",
];
const DEFAULT_LOOKBACK_DAYS = 45;
const MAX_WRAP_QUERY_LIMIT = 5000;

type AppNostrPool = Pick<SimplePool, "querySync">;

interface NostrEventLike {
  content: string;
  id: string;
  kind: number;
  pubkey: string;
  tags: string[][];
}

export interface FetchTelemetryResult {
  fetchedWrapCount: number;
  ignoredWrapCount: number;
  relayUrls: string[];
  telemetryEvents: PaymentTelemetryEvent[];
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
    const value = String(relayUrl).trim();
    if (!value.startsWith("wss://")) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }

  return unique;
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

const loadRelayListForPubkey = async (
  publicKeyHex: string,
): Promise<string[]> => {
  const pool = await getSharedPool();
  const relayEvents = await pool.querySync(
    DEFAULT_RELAYS,
    { authors: [publicKeyHex], kinds: [RELAY_LIST_KIND], limit: 5 },
    { maxWait: 5000 },
  );

  const newest = relayEvents
    .slice()
    .sort((left, right) => (right.created_at ?? 0) - (left.created_at ?? 0))[0];

  if (!newest) return DEFAULT_RELAYS;

  const relayUrls = newest.tags
    .filter((tag) => Array.isArray(tag) && tag[0] === "r" && Boolean(tag[1]))
    .map((tag) => String(tag[1]).trim());

  const normalized = normalizeRelayUrls([...DEFAULT_RELAYS, ...relayUrls]);
  return normalized.length > 0 ? normalized : DEFAULT_RELAYS;
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
  const filter: Filter = {
    kinds: [GIFT_WRAP_KIND],
    limit: MAX_WRAP_QUERY_LIMIT,
    since,
  };

  filter["#p"] = [args.publicKeyHex];

  const wrapEvents = await pool.querySync(relayUrls, filter, {
    maxWait: 12000,
  });
  const telemetryById = new Map<string, PaymentTelemetryEvent>();
  let ignoredWrapCount = 0;

  for (const wrap of wrapEvents) {
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
    fetchedWrapCount: wrapEvents.length,
    ignoredWrapCount,
    relayUrls,
    telemetryEvents,
  };
};
