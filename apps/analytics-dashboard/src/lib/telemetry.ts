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

type LegacyPaymentTelemetryPlatform = "android" | "ios" | "web";
export type PaymentTelemetryDevicePlatform =
  | "android"
  | "iphone"
  | "ipad"
  | "linux"
  | "mac"
  | "windows"
  | "unknown";
export type PaymentTelemetryAppRuntime = "native" | "pwa" | "web";
export type PaymentTelemetryStatus = "declined" | "error" | "ok";
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

const LEGACY_PAYMENT_PLATFORMS: readonly LegacyPaymentTelemetryPlatform[] = [
  "android",
  "ios",
  "web",
];
export const PAYMENT_DEVICE_PLATFORMS: readonly PaymentTelemetryDevicePlatform[] =
  ["android", "iphone", "ipad", "linux", "mac", "windows", "unknown"];
export const PAYMENT_APP_RUNTIMES: readonly PaymentTelemetryAppRuntime[] = [
  "native",
  "pwa",
  "web",
];
export const PERIOD_FILTERS: readonly PeriodFilter[] = ["today", "7d", "30d"];

export interface PaymentTelemetryEvent {
  amountBucket: string | null;
  appRuntime: PaymentTelemetryAppRuntime | null;
  appVersion: string | null;
  createdAtSec: number;
  devicePlatform: PaymentTelemetryDevicePlatform | null;
  direction: "in" | "out";
  errorCode: string | null;
  errorDetail: string | null;
  feeBucket: string | null;
  id: string;
  method: PaymentTelemetryMethod;
  mint: string | null;
  phase: PaymentTelemetryPhase;
  senderPubkey: string;
  status: PaymentTelemetryStatus;
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

export interface ErrorDetailSummaryItem {
  count: number;
  errorDetail: string | null;
}

export interface ErrorSummaryItem {
  count: number;
  details: ErrorDetailSummaryItem[];
  errorCode: string;
}

export interface MintSummaryItem {
  count: number;
  mint: string | null;
}

export interface MintSeriesItem {
  errorCount: number;
  mint: string | null;
  successCount: number;
}

export interface MethodSeriesItem {
  errorCount: number;
  method: PaymentTelemetryMethod;
  successCount: number;
}

export interface CategorySeriesItem {
  errorCount: number;
  key: string;
  label: string;
  successCount: number;
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

const toTrimmedStringOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toTwoDigitString = (value: number): string => {
  return String(value).padStart(2, "0");
};

const toLocalDayKey = (date: Date): string => {
  return `${date.getFullYear()}-${toTwoDigitString(date.getMonth() + 1)}-${toTwoDigitString(date.getDate())}`;
};

const toLocalHourKey = (date: Date): string => {
  return `${toLocalDayKey(date)}T${toTwoDigitString(date.getHours())}`;
};

const parseDayKey = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  parsed.setHours(0, 0, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
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

const isLegacyTelemetryPlatform = (
  value: unknown,
): value is LegacyPaymentTelemetryPlatform => {
  return LEGACY_PAYMENT_PLATFORMS.some((platform) => platform === value);
};

const isTelemetryDevicePlatform = (
  value: unknown,
): value is PaymentTelemetryDevicePlatform => {
  return PAYMENT_DEVICE_PLATFORMS.some((platform) => platform === value);
};

const isTelemetryAppRuntime = (
  value: unknown,
): value is PaymentTelemetryAppRuntime => {
  return PAYMENT_APP_RUNTIMES.some((runtime) => runtime === value);
};

const isTelemetryStatus = (value: unknown): value is PaymentTelemetryStatus => {
  return value === "ok" || value === "declined" || value === "error";
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
  const errorDetail = Reflect.get(parsed, "errorDetail");
  const mintValue = Reflect.get(parsed, "mint");
  const legacyPlatform = Reflect.get(parsed, "platform");
  const devicePlatformValue = Reflect.get(parsed, "devicePlatform");
  const appRuntimeValue = Reflect.get(parsed, "appRuntime");
  const appVersionValue = Reflect.get(parsed, "appVersion");
  const mint =
    mintValue === undefined
      ? null
      : isStringOrNull(mintValue)
        ? toTrimmedStringOrNull(mintValue)
        : false;
  const normalizedLegacyPlatform =
    legacyPlatform === undefined
      ? null
      : isLegacyTelemetryPlatform(legacyPlatform)
        ? legacyPlatform
        : false;
  const devicePlatform =
    devicePlatformValue === undefined
      ? normalizedLegacyPlatform === "android"
        ? "android"
        : normalizedLegacyPlatform === "ios"
          ? "iphone"
          : normalizedLegacyPlatform === "web"
            ? "unknown"
            : null
      : devicePlatformValue === null
        ? null
        : isTelemetryDevicePlatform(devicePlatformValue)
          ? devicePlatformValue
          : false;
  const appRuntime =
    appRuntimeValue === undefined
      ? normalizedLegacyPlatform === "web"
        ? "web"
        : normalizedLegacyPlatform === "android" ||
            normalizedLegacyPlatform === "ios"
          ? "native"
          : null
      : appRuntimeValue === null
        ? null
        : isTelemetryAppRuntime(appRuntimeValue)
          ? appRuntimeValue
          : false;
  const appVersion =
    appVersionValue === undefined
      ? null
      : isStringOrNull(appVersionValue)
        ? toTrimmedStringOrNull(appVersionValue)
        : false;

  if (typeof id !== "string" || id.trim().length === 0) return null;
  if (
    typeof createdAtSec !== "number" ||
    !Number.isFinite(createdAtSec) ||
    createdAtSec <= 0
  ) {
    return null;
  }
  if (direction !== "in" && direction !== "out") return null;
  if (!isTelemetryStatus(status)) return null;
  if (!isTelemetryMethod(method)) return null;
  if (!isTelemetryPhase(phase)) return null;
  if (normalizedLegacyPlatform === false) return null;
  if (devicePlatform === false) return null;
  if (appRuntime === false) return null;
  if (appVersion === false) return null;
  if (mint === false) return null;
  if (!isStringOrNull(amountBucket)) return null;
  if (!isStringOrNull(feeBucket)) return null;
  if (!isStringOrNull(errorCode)) return null;
  if (!isStringOrNull(errorDetail)) return null;

  return {
    amountBucket,
    appRuntime,
    appVersion,
    createdAtSec: Math.trunc(createdAtSec),
    devicePlatform,
    direction,
    errorCode,
    errorDetail,
    feeBucket,
    id,
    method,
    mint,
    phase,
    status,
  };
};

const buildCategorySeries = (
  telemetry: readonly PaymentTelemetryEvent[],
  resolveCategory: (event: PaymentTelemetryEvent) => string | null,
  formatLabel: (value: string | null) => string,
): CategorySeriesItem[] => {
  const counts = new Map<string, CategorySeriesItem>();

  for (const event of telemetry) {
    if (event.status === "declined") continue;

    const value = resolveCategory(event);
    const key = value ?? "__unknown__";
    const existing = counts.get(key) ?? {
      errorCount: 0,
      key,
      label: formatLabel(value),
      successCount: 0,
    };

    if (event.status === "ok") {
      existing.successCount += 1;
    } else if (event.status === "error") {
      existing.errorCount += 1;
    }

    counts.set(key, existing);
  }

  return Array.from(counts.values()).sort((left, right) => {
    const rightTotal = right.successCount + right.errorCount;
    const leftTotal = left.successCount + left.errorCount;
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    return left.label.localeCompare(right.label);
  });
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

export const buildMintOptions = (
  telemetry: readonly PaymentTelemetryEvent[],
): string[] => {
  const unique = new Set<string>();

  for (const event of telemetry) {
    if (!event.mint) continue;
    unique.add(event.mint);
  }

  return Array.from(unique).sort((left, right) => left.localeCompare(right));
};

const getPeriodStart = (period: PeriodFilter, nowMs: number): number => {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (PERIOD_DAY_COUNT[period] - 1));
  return date.getTime();
};

export const filterTelemetryEvents = (args: {
  date?: string | null;
  mint?: string | null;
  method: MethodFilter;
  nowMs?: number;
  period: PeriodFilter;
  telemetry: readonly PaymentTelemetryEvent[];
}): PaymentTelemetryEvent[] => {
  const nowMs = args.nowMs ?? Date.now();
  const periodStartMs = getPeriodStart(args.period, nowMs);
  const selectedDay = args.date ? parseDayKey(args.date) : null;
  const selectedDayKey = selectedDay ? toLocalDayKey(selectedDay) : null;

  return args.telemetry.filter((event) => {
    const eventMs = event.createdAtSec * 1000;
    if (eventMs > nowMs) return false;
    if (selectedDayKey) {
      if (toLocalDayKey(new Date(eventMs)) !== selectedDayKey) return false;
    } else if (eventMs < periodStartMs) {
      return false;
    }
    if (args.method !== "all" && event.method !== args.method) return false;
    if (args.mint && event.mint !== args.mint) return false;
    return true;
  });
};

export const buildDailySeries = (args: {
  date?: string | null;
  nowMs?: number;
  period: PeriodFilter;
  telemetry: readonly PaymentTelemetryEvent[];
}): DailySeriesItem[] => {
  const nowMs = args.nowMs ?? Date.now();
  const selectedDay = args.date ? parseDayKey(args.date) : null;
  const selectedDayKey = selectedDay ? toLocalDayKey(selectedDay) : null;
  const shouldRenderHourly = args.period === "today" || Boolean(selectedDay);
  const startMs = selectedDay
    ? selectedDay.getTime()
    : getPeriodStart(args.period, nowMs);
  const items: DailySeriesItem[] = [];
  const byDay = new Map<string, DailySeriesItem>();

  if (shouldRenderHourly) {
    const startHour = new Date(startMs);
    startHour.setMinutes(0, 0, 0);
    const lastHour = selectedDay
      ? new Date(selectedDay.getTime() + 23 * 60 * 60 * 1000)
      : new Date(nowMs);
    lastHour.setMinutes(0, 0, 0);

    for (
      let cursorMs = startHour.getTime();
      cursorMs <= lastHour.getTime();
      cursorMs += 60 * 60 * 1000
    ) {
      const hourStart = new Date(cursorMs);
      const key = toLocalHourKey(hourStart);
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
      if (selectedDayKey) {
        const eventDayKey = toLocalDayKey(new Date(event.createdAtSec * 1000));
        if (eventDayKey !== selectedDayKey) continue;
      }

      const hour = new Date(event.createdAtSec * 1000);
      hour.setMinutes(0, 0, 0);
      const key = toLocalHourKey(hour);
      const target = byDay.get(key);
      if (!target) continue;

      if (event.status === "ok") {
        target.successCount += 1;
      } else if (event.status === "error") {
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
    const key = toLocalDayKey(dayStart);
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
    const key = toLocalDayKey(day);
    const target = byDay.get(key);
    if (!target) continue;

    if (event.status === "ok") {
      target.successCount += 1;
    } else if (event.status === "error") {
      target.errorCount += 1;
    }
  }

  return items;
};

export const buildErrorSummary = (
  telemetry: readonly PaymentTelemetryEvent[],
): ErrorSummaryItem[] => {
  const counts = new Map<
    string,
    {
      count: number;
      details: Map<string, ErrorDetailSummaryItem>;
    }
  >();

  for (const event of telemetry) {
    if (event.status !== "error") continue;
    const errorCode = event.errorCode?.trim();
    if (!errorCode) continue;

    const trimmedErrorDetail = event.errorDetail?.trim() ?? null;
    const errorDetail =
      trimmedErrorDetail && trimmedErrorDetail.length > 0
        ? trimmedErrorDetail
        : null;
    const detailKey = errorDetail ?? "__empty__";
    const bucket = counts.get(errorCode) ?? {
      count: 0,
      details: new Map<string, ErrorDetailSummaryItem>(),
    };

    bucket.count += 1;

    const existingDetail = bucket.details.get(detailKey);
    if (existingDetail) {
      existingDetail.count += 1;
    } else {
      bucket.details.set(detailKey, {
        count: 1,
        errorDetail,
      });
    }

    counts.set(errorCode, bucket);
  }

  return Array.from(counts.entries())
    .map(([errorCode, value]) => ({
      count: value.count,
      details: Array.from(value.details.values()).sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;

        if (left.errorDetail === null) return 1;
        if (right.errorDetail === null) return -1;
        return left.errorDetail.localeCompare(right.errorDetail);
      }),
      errorCode,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.errorCode.localeCompare(right.errorCode);
    });
};

export const buildMintSummary = (
  telemetry: readonly PaymentTelemetryEvent[],
): MintSummaryItem[] => {
  const counts = new Map<string, MintSummaryItem>();

  for (const event of telemetry) {
    const key = event.mint ?? "__unknown__";
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(key, {
      count: 1,
      mint: event.mint,
    });
  }

  return Array.from(counts.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    if (left.mint === null) return 1;
    if (right.mint === null) return -1;
    return left.mint.localeCompare(right.mint);
  });
};

export const buildMintSeries = (
  telemetry: readonly PaymentTelemetryEvent[],
): MintSeriesItem[] => {
  const counts = new Map<string, MintSeriesItem>();

  for (const event of telemetry) {
    if (event.status === "declined") continue;

    const key = event.mint ?? "__unknown__";
    const existing = counts.get(key) ?? {
      errorCount: 0,
      mint: event.mint,
      successCount: 0,
    };

    if (event.status === "ok") {
      existing.successCount += 1;
    } else if (event.status === "error") {
      existing.errorCount += 1;
    }

    counts.set(key, existing);
  }

  return Array.from(counts.values()).sort((left, right) => {
    const rightTotal = right.successCount + right.errorCount;
    const leftTotal = left.successCount + left.errorCount;
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    if (left.mint === null) return 1;
    if (right.mint === null) return -1;
    return left.mint.localeCompare(right.mint);
  });
};

export const buildMethodSeries = (
  telemetry: readonly PaymentTelemetryEvent[],
): MethodSeriesItem[] => {
  const counts = new Map<PaymentTelemetryMethod, MethodSeriesItem>();

  for (const event of telemetry) {
    if (event.status === "declined") continue;

    const existing = counts.get(event.method) ?? {
      errorCount: 0,
      method: event.method,
      successCount: 0,
    };

    if (event.status === "ok") {
      existing.successCount += 1;
    } else if (event.status === "error") {
      existing.errorCount += 1;
    }

    counts.set(event.method, existing);
  }

  return Array.from(counts.values()).sort((left, right) => {
    const rightTotal = right.successCount + right.errorCount;
    const leftTotal = left.successCount + left.errorCount;
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    return left.method.localeCompare(right.method);
  });
};

export const buildDevicePlatformSeries = (
  telemetry: readonly PaymentTelemetryEvent[],
): CategorySeriesItem[] => {
  return buildCategorySeries(
    telemetry,
    (event) => event.devicePlatform,
    (value) => value ?? "Unknown device",
  );
};

export const buildAppRuntimeSeries = (
  telemetry: readonly PaymentTelemetryEvent[],
): CategorySeriesItem[] => {
  return buildCategorySeries(
    telemetry,
    (event) => event.appRuntime,
    (value) => value ?? "Unknown runtime",
  );
};

export const buildAppVersionSeries = (
  telemetry: readonly PaymentTelemetryEvent[],
): CategorySeriesItem[] => {
  return buildCategorySeries(
    telemetry,
    (event) => event.appVersion,
    (value) => value ?? "Unknown version",
  );
};

export const formatShortNpub = (npub: string): string => {
  if (npub.length <= 18) return npub;
  return `${npub.slice(0, 10)}...${npub.slice(-8)}`;
};
