export const PAYMENT_TELEMETRY_KIND = 24134;

export type PaymentTelemetryMethod =
  | "cashu_chat"
  | "cashu_receive"
  | "cashu_restore"
  | "lightning_address"
  | "lightning_invoice"
  | "unknown";

export type PaymentTelemetryPhase =
  | "complete"
  | "invoice_fetch"
  | "melt"
  | "publish"
  | "receive"
  | "restore"
  | "swap"
  | "unknown";

export type PaymentTelemetryPlatform = "android" | "ios" | "web";
export type PeriodFilter = "today" | "7d" | "30d";
export type MethodFilter = PaymentTelemetryMethod | "all";

export const PAYMENT_METHODS: readonly PaymentTelemetryMethod[] = [
  "cashu_chat",
  "cashu_receive",
  "cashu_restore",
  "lightning_address",
  "lightning_invoice",
  "unknown",
];

export const PAYMENT_PHASES: readonly PaymentTelemetryPhase[] = [
  "complete",
  "invoice_fetch",
  "melt",
  "publish",
  "receive",
  "restore",
  "swap",
  "unknown",
];

export const PAYMENT_PLATFORMS: readonly PaymentTelemetryPlatform[] = [
  "android",
  "ios",
  "web",
];
export const PERIOD_FILTERS: readonly PeriodFilter[] = ["today", "7d", "30d"];

export interface PaymentTelemetryEvent {
  amountBucket: string | null;
  appVersion: string;
  createdAtSec: number;
  direction: "in" | "out";
  errorCode: string | null;
  feeBucket: string | null;
  id: string;
  method: PaymentTelemetryMethod;
  phase: PaymentTelemetryPhase;
  platform: PaymentTelemetryPlatform;
  senderPubkey: string;
  status: "ok" | "error";
  wrapId: string;
}

export interface DailySeriesItem {
  bucketKind: "day" | "hour";
  dayKey: string;
  errorCount: number;
  label: string;
  successCount: number;
  timestampMs: number;
}

export interface ErrorSummaryItem {
  count: number;
  errorCode: string;
}

const PERIOD_DAY_COUNT: Record<PeriodFilter, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isStringOrNull = (value: unknown): value is string | null => {
  return typeof value === "string" || value === null;
};

const isStringArrayArray = (value: unknown): value is string[][] => {
  if (!Array.isArray(value)) return false;

  return value.every((entry) => {
    return (
      Array.isArray(entry) && entry.every((item) => typeof item === "string")
    );
  });
};

const isTelemetryMethod = (value: unknown): value is PaymentTelemetryMethod => {
  return PAYMENT_METHODS.some((method) => method === value);
};

const isTelemetryPhase = (value: unknown): value is PaymentTelemetryPhase => {
  return PAYMENT_PHASES.some((phase) => phase === value);
};

const isTelemetryPlatform = (
  value: unknown,
): value is PaymentTelemetryPlatform => {
  return PAYMENT_PLATFORMS.some((platform) => platform === value);
};

export const isMethodFilter = (value: string): value is MethodFilter => {
  return value === "all" || isTelemetryMethod(value);
};

export const isGiftWrapAddressedToPubkey = (
  tags: unknown,
  publicKeyHex: string,
): boolean => {
  if (!isStringArrayArray(tags)) return false;

  return tags.some((tag) => tag[0] === "p" && tag[1] === publicKeyHex);
};

export const parsePaymentTelemetryContent = (
  content: string,
): Omit<PaymentTelemetryEvent, "senderPubkey" | "wrapId"> | null => {
  let parsed: unknown = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed)) return null;

  const id = Reflect.get(parsed, "id");
  const createdAtSec = Reflect.get(parsed, "createdAtSec");
  const direction = Reflect.get(parsed, "direction");
  const status = Reflect.get(parsed, "status");
  const method = Reflect.get(parsed, "method");
  const phase = Reflect.get(parsed, "phase");
  const amountBucket = Reflect.get(parsed, "amountBucket");
  const feeBucket = Reflect.get(parsed, "feeBucket");
  const errorCode = Reflect.get(parsed, "errorCode");
  const platform = Reflect.get(parsed, "platform");
  const appVersion = Reflect.get(parsed, "appVersion");

  if (typeof id !== "string" || id.trim().length === 0) return null;
  if (
    typeof createdAtSec !== "number" ||
    !Number.isFinite(createdAtSec) ||
    createdAtSec <= 0
  ) {
    return null;
  }
  if (direction !== "in" && direction !== "out") return null;
  if (status !== "ok" && status !== "error") return null;
  if (!isTelemetryMethod(method)) return null;
  if (!isTelemetryPhase(phase)) return null;
  if (!isTelemetryPlatform(platform)) return null;
  if (typeof appVersion !== "string") return null;
  if (!isStringOrNull(amountBucket)) return null;
  if (!isStringOrNull(feeBucket)) return null;
  if (!isStringOrNull(errorCode)) return null;

  return {
    amountBucket,
    appVersion,
    createdAtSec: Math.trunc(createdAtSec),
    direction,
    errorCode,
    feeBucket,
    id,
    method,
    phase,
    platform,
    status,
  };
};

export const buildMethodOptions = (
  telemetry: readonly PaymentTelemetryEvent[],
): PaymentTelemetryMethod[] => {
  const unique = new Set<PaymentTelemetryMethod>();

  for (const event of telemetry) {
    unique.add(event.method);
  }

  return Array.from(unique).sort();
};

const getPeriodStart = (period: PeriodFilter, nowMs: number): number => {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (PERIOD_DAY_COUNT[period] - 1));
  return date.getTime();
};

export const filterTelemetryEvents = (args: {
  method: MethodFilter;
  nowMs?: number;
  period: PeriodFilter;
  telemetry: readonly PaymentTelemetryEvent[];
}): PaymentTelemetryEvent[] => {
  const nowMs = args.nowMs ?? Date.now();
  const periodStartMs = getPeriodStart(args.period, nowMs);

  return args.telemetry.filter((event) => {
    const eventMs = event.createdAtSec * 1000;
    if (eventMs < periodStartMs || eventMs > nowMs) return false;
    if (args.method !== "all" && event.method !== args.method) return false;
    return true;
  });
};

export const buildDailySeries = (args: {
  nowMs?: number;
  period: PeriodFilter;
  telemetry: readonly PaymentTelemetryEvent[];
}): DailySeriesItem[] => {
  const nowMs = args.nowMs ?? Date.now();
  const startMs = getPeriodStart(args.period, nowMs);
  const items: DailySeriesItem[] = [];
  const byDay = new Map<string, DailySeriesItem>();

  if (args.period === "today") {
    const startHour = new Date(startMs);
    startHour.setMinutes(0, 0, 0);
    const lastHour = new Date(nowMs);
    lastHour.setMinutes(0, 0, 0);

    for (
      let cursorMs = startHour.getTime();
      cursorMs <= lastHour.getTime();
      cursorMs += 60 * 60 * 1000
    ) {
      const hourStart = new Date(cursorMs);
      const key = hourStart.toISOString().slice(0, 13);
      const item: DailySeriesItem = {
        bucketKind: "hour",
        dayKey: key,
        errorCount: 0,
        label: hourStart.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        successCount: 0,
        timestampMs: hourStart.getTime(),
      };
      byDay.set(key, item);
      items.push(item);
    }

    for (const event of args.telemetry) {
      const hour = new Date(event.createdAtSec * 1000);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString().slice(0, 13);
      const target = byDay.get(key);
      if (!target) continue;

      if (event.status === "ok") {
        target.successCount += 1;
      } else {
        target.errorCount += 1;
      }
    }

    return items;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  });

  for (
    let cursorMs = startMs;
    cursorMs <= nowMs;
    cursorMs += 24 * 60 * 60 * 1000
  ) {
    const dayStart = new Date(cursorMs);
    dayStart.setHours(0, 0, 0, 0);
    const key = dayStart.toISOString().slice(0, 10);
    const item: DailySeriesItem = {
      bucketKind: "day",
      dayKey: key,
      errorCount: 0,
      label: formatter.format(dayStart),
      successCount: 0,
      timestampMs: dayStart.getTime(),
    };
    byDay.set(key, item);
    items.push(item);
  }

  for (const event of args.telemetry) {
    const day = new Date(event.createdAtSec * 1000);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString().slice(0, 10);
    const target = byDay.get(key);
    if (!target) continue;

    if (event.status === "ok") {
      target.successCount += 1;
    } else {
      target.errorCount += 1;
    }
  }

  return items;
};

export const buildErrorSummary = (
  telemetry: readonly PaymentTelemetryEvent[],
): ErrorSummaryItem[] => {
  const counts = new Map<string, number>();

  for (const event of telemetry) {
    if (event.status !== "error") continue;
    const errorCode = event.errorCode?.trim();
    if (!errorCode) continue;
    counts.set(errorCode, (counts.get(errorCode) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([errorCode, count]) => ({ count, errorCode }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.errorCode.localeCompare(right.errorCode);
    });
};

export const formatShortNpub = (npub: string): string => {
  if (npub.length <= 18) return npub;
  return `${npub.slice(0, 10)}...${npub.slice(-8)}`;
};
