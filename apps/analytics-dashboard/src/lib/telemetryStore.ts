import * as Evolu from "@evolu/common";
import { evoluReactWebDeps } from "@evolu/react-web";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  isTelemetryAppRuntime,
  isTelemetryDevicePlatform,
  isTelemetryMethod,
  isTelemetryPaymentType,
  isTelemetryPhase,
  isTelemetryStatus,
  type PaymentTelemetryEvent,
} from "./telemetry";

const configuredServers = (import.meta.env.VITE_EVOLU_SERVER_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));

/** Evolu relays the telemetry archive syncs through. */
export const EVOLU_SERVERS: readonly string[] = configuredServers.length
  ? configuredServers
  : ["wss://evolu.linky.fit"];

const PaymentTelemetryEventId = Evolu.id("PaymentTelemetryEvent");
type PaymentTelemetryEventId = typeof PaymentTelemetryEventId.Type;

// Every column mirrors PaymentTelemetryEvent; `eventId` is the report id from
// the wire (the Evolu row id is derived from it, see toRowId).
const schema = {
  paymentTelemetryEvent: {
    id: PaymentTelemetryEventId,
    eventId: Evolu.NonEmptyString100,
    createdAtSec: Evolu.PositiveInt,
    direction: Evolu.NonEmptyString100,
    status: Evolu.NonEmptyString100,
    method: Evolu.NonEmptyString100,
    phase: Evolu.NonEmptyString100,
    // Added later; Evolu adds the column to existing databases on open and
    // older rows read back as null.
    paymentType: Evolu.nullOr(Evolu.NonEmptyString100),
    mint: Evolu.nullOr(Evolu.NonEmptyString1000),
    amountBucket: Evolu.nullOr(Evolu.NonEmptyString100),
    feeBucket: Evolu.nullOr(Evolu.NonEmptyString100),
    errorCode: Evolu.nullOr(Evolu.NonEmptyString100),
    errorDetail: Evolu.nullOr(Evolu.NonEmptyString1000),
    appHost: Evolu.nullOr(Evolu.NonEmptyString1000),
    devicePlatform: Evolu.nullOr(Evolu.NonEmptyString100),
    appRuntime: Evolu.nullOr(Evolu.NonEmptyString100),
    appVersion: Evolu.nullOr(Evolu.NonEmptyString100),
    senderPubkey: Evolu.NonEmptyString100,
    wrapId: Evolu.NonEmptyString100,
  },
};

const toRowId = (eventId: string): PaymentTelemetryEventId =>
  Evolu.createIdFromString<"PaymentTelemetryEvent">(
    `payment-telemetry:${eventId}`,
  );

const clip = (value: string | null, max: number): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

export const createTelemetryStore = (ownerMnemonic: string) => {
  const mnemonic = Evolu.Mnemonic.fromUnknown(ownerMnemonic);
  if (!mnemonic.ok) {
    throw new Error("Could not derive the telemetry database owner.");
  }
  const ownerSecret = Evolu.mnemonicToOwnerSecret(mnemonic.value);
  const owner = Evolu.createAppOwner(ownerSecret);
  ownerSecret.fill(0);

  const evolu = Evolu.createEvolu(evoluReactWebDeps)(schema, {
    name: Evolu.SimpleName.orThrow(`linky-analytics-${owner.id}`),
    externalAppOwner: owner,
    transports: EVOLU_SERVERS.map((url) => ({ type: "WebSocket", url })),
  });

  const query = evolu.createQuery((db) =>
    db
      .selectFrom("paymentTelemetryEvent")
      .selectAll()
      .where("isDeleted", "is not", Evolu.sqliteTrue),
  );

  /**
   * Upserts reports that are missing from the archive (or carry a newer
   * createdAtSec) and resolves with how many rows were written.
   */
  const saveEvents = async (
    events: readonly PaymentTelemetryEvent[],
  ): Promise<number> => {
    const rows = await evolu.loadQuery(query);
    const known = new Map<string, number>();
    for (const row of rows) {
      if (row.eventId !== null && row.createdAtSec !== null) {
        known.set(row.eventId, row.createdAtSec);
      }
    }

    const pending = events.filter((event) => {
      const knownCreatedAt = known.get(event.id);
      return (
        knownCreatedAt === undefined || knownCreatedAt < event.createdAtSec
      );
    });
    if (pending.length === 0) return 0;

    return new Promise<number>((resolve, reject) => {
      const fail = (message: string) => {
        unsubscribe();
        reject(new Error(message));
      };
      const unsubscribe = evolu.subscribeError(() => {
        if (evolu.getError()) fail("The telemetry archive rejected the write.");
      });
      if (evolu.getError()) {
        fail("The telemetry archive is unavailable.");
        return;
      }

      let written = 0;
      pending.forEach((event, index) => {
        const isLast = index === pending.length - 1;
        const result = evolu.upsert(
          "paymentTelemetryEvent",
          {
            id: toRowId(event.id),
            eventId: clip(event.id, 100) ?? event.id,
            createdAtSec: event.createdAtSec,
            direction: event.direction,
            status: event.status,
            method: event.method,
            phase: event.phase,
            paymentType: event.paymentType,
            mint: clip(event.mint, 1000),
            amountBucket: clip(event.amountBucket, 100),
            feeBucket: clip(event.feeBucket, 100),
            errorCode: clip(event.errorCode, 100),
            errorDetail: clip(event.errorDetail, 1000),
            appHost: clip(event.appHost, 1000),
            devicePlatform: event.devicePlatform,
            appRuntime: event.appRuntime,
            appVersion: clip(event.appVersion, 100),
            senderPubkey: event.senderPubkey,
            wrapId: event.wrapId,
          },
          isLast
            ? {
                onComplete: () => {
                  unsubscribe();
                  resolve(written);
                },
              }
            : undefined,
        );
        if (result.ok) {
          written += 1;
        } else if (isLast) {
          // The last mutation carried the completion callback; without it the
          // batch still commits, so settle on the next tick instead.
          unsubscribe();
          resolve(written);
        }
      });
    });
  };

  return { evolu, query, saveEvents } as const;
};

export type TelemetryStore = ReturnType<typeof createTelemetryStore>;

const readRows = (store: TelemetryStore) =>
  store.evolu.getQueryRows(store.query);

type TelemetryRows = ReturnType<typeof readRows>;
type TelemetryRow = TelemetryRows[number];

const EMPTY_ROWS: TelemetryRows = [];

const noopSubscribe = () => () => undefined;
const getNoError = () => null;

const toTelemetryEvent = (row: TelemetryRow): PaymentTelemetryEvent | null => {
  if (
    row.eventId === null ||
    row.createdAtSec === null ||
    row.senderPubkey === null ||
    row.wrapId === null
  ) {
    return null;
  }
  const direction: "in" | "out" | null =
    row.direction === "in" ? "in" : row.direction === "out" ? "out" : null;
  if (direction === null) return null;
  if (!isTelemetryStatus(row.status)) return null;
  if (!isTelemetryMethod(row.method)) return null;
  if (!isTelemetryPhase(row.phase)) return null;

  return {
    amountBucket: row.amountBucket,
    appHost: row.appHost,
    appRuntime: isTelemetryAppRuntime(row.appRuntime) ? row.appRuntime : null,
    appVersion: row.appVersion,
    createdAtSec: row.createdAtSec,
    devicePlatform: isTelemetryDevicePlatform(row.devicePlatform)
      ? row.devicePlatform
      : null,
    direction,
    errorCode: row.errorCode,
    errorDetail: row.errorDetail,
    feeBucket: row.feeBucket,
    id: row.eventId,
    method: row.method,
    mint: row.mint,
    paymentType: isTelemetryPaymentType(row.paymentType)
      ? row.paymentType
      : null,
    phase: row.phase,
    senderPubkey: row.senderPubkey,
    status: row.status,
    wrapId: row.wrapId,
  };
};

export interface StoredTelemetry {
  error: string | null;
  events: PaymentTelemetryEvent[];
  /** True once the local database answered the first query for this store. */
  ready: boolean;
}

export const useStoredTelemetry = (
  store: TelemetryStore | null,
): StoredTelemetry => {
  const subscribeRows = useMemo(
    () => (store ? store.evolu.subscribeQuery(store.query) : noopSubscribe),
    [store],
  );
  const getRows = useMemo(
    () => (store ? () => readRows(store) : () => EMPTY_ROWS),
    [store],
  );
  const rows = useSyncExternalStore(subscribeRows, getRows);
  const databaseError = useSyncExternalStore(
    store ? store.evolu.subscribeError : noopSubscribe,
    store ? store.evolu.getError : getNoError,
  );
  const [loadedStore, setLoadedStore] = useState<TelemetryStore | null>(null);
  const [failedStore, setFailedStore] = useState<TelemetryStore | null>(null);

  useEffect(() => {
    if (!store) return;
    let active = true;
    store.evolu
      .loadQuery(store.query)
      .then(() => {
        if (active) setLoadedStore(store);
      })
      .catch(() => {
        if (active) setFailedStore(store);
      });
    return () => {
      active = false;
    };
  }, [store]);

  const events = useMemo(
    () =>
      rows.flatMap((row) => {
        const event = toTelemetryEvent(row);
        return event ? [event] : [];
      }),
    [rows],
  );

  return {
    error:
      store && (databaseError || failedStore === store)
        ? "The telemetry archive could not be opened. Reload and try again."
        : null,
    events,
    ready: store !== null && loadedStore === store,
  };
};
