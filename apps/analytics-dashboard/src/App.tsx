import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import {
  deriveIdentityFromSlip39,
  looksLikeSlip39Seed,
  normalizeSlip39Seed,
  type DerivedIdentity,
} from "./lib/identity";
import { fetchAccountProfile, fetchTelemetryForCollector } from "./lib/nostr";
import {
  buildDailySeries,
  buildErrorSummary,
  buildMethodSeries,
  buildMintSeries,
  filterTelemetryEvents,
  PERIOD_FILTERS,
  type DailySeriesItem,
  type ErrorSummaryItem,
  type MethodFilter,
  type MethodSeriesItem,
  type MintSeriesItem,
  type PaymentTelemetryEvent,
  type PeriodFilter,
} from "./lib/telemetry";

interface DashboardSnapshot {
  fetchedWrapCount: number;
  ignoredWrapCount: number;
  lastFetchedAtMs: number;
  relayUrls: string[];
  telemetryEvents: PaymentTelemetryEvent[];
}

interface PersistedSessionSnapshot {
  dashboard: DashboardSnapshot | null;
  profile: AccountProfileState;
  publicKeyHex: string;
  seed: string;
}

interface AccountProfileState {
  imageUrl: string | null;
  name: string | null;
}

type LoadPhase = "idle" | "authenticating" | "loading" | "ready" | "error";

const PERIOD_LABELS: Record<PeriodFilter, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

const METHOD_LABELS: Record<MethodFilter, string> = {
  all: "All methods",
  cashu_chat: "Cashu chat",
  cashu_receive: "Cashu receive",
  cashu_restore: "Cashu restore",
  lightning_address: "Lightning address",
  lightning_invoice: "Lightning invoice",
  unknown: "Unknown",
};

const PERSISTED_SESSION_STORAGE_KEY = "analytics-dashboard-session-v1";
const ALL_METHODS_VALUE = "all";
const UNKNOWN_MINT_FILTER_VALUE = "__unknown__";

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isDashboardSnapshot = (value: unknown): value is DashboardSnapshot => {
  if (!isObjectRecord(value)) {
    return false;
  }

  const fetchedWrapCount = Reflect.get(value, "fetchedWrapCount");
  const ignoredWrapCount = Reflect.get(value, "ignoredWrapCount");
  const lastFetchedAtMs = Reflect.get(value, "lastFetchedAtMs");
  const relayUrls = Reflect.get(value, "relayUrls");
  const telemetryEvents = Reflect.get(value, "telemetryEvents");

  return (
    typeof fetchedWrapCount === "number" &&
    typeof ignoredWrapCount === "number" &&
    typeof lastFetchedAtMs === "number" &&
    Array.isArray(relayUrls) &&
    relayUrls.every((item) => typeof item === "string") &&
    Array.isArray(telemetryEvents)
  );
};

const isAccountProfileState = (
  value: unknown,
): value is AccountProfileState => {
  if (!isObjectRecord(value)) {
    return false;
  }

  const imageUrl = Reflect.get(value, "imageUrl");
  const name = Reflect.get(value, "name");

  return (
    (typeof imageUrl === "string" || imageUrl === null) &&
    (typeof name === "string" || name === null)
  );
};

const readPersistedSession = (): PersistedSessionSnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(PERSISTED_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed)) {
    return null;
  }

  const seed = Reflect.get(parsed, "seed");
  const publicKeyHex = Reflect.get(parsed, "publicKeyHex");
  const dashboard = Reflect.get(parsed, "dashboard");
  const profile = Reflect.get(parsed, "profile");

  if (typeof seed !== "string" || typeof publicKeyHex !== "string") {
    return null;
  }

  return {
    dashboard:
      dashboard === null
        ? null
        : isDashboardSnapshot(dashboard)
          ? dashboard
          : null,
    profile: isAccountProfileState(profile)
      ? profile
      : { imageUrl: null, name: null },
    publicKeyHex,
    seed,
  };
};

const persistSession = (session: PersistedSessionSnapshot): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    PERSISTED_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  );
};

const clearPersistedSession = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PERSISTED_SESSION_STORAGE_KEY);
};

const formatTimestamp = (timestampMs: number): string => {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
};

const formatShare = (count: number, total: number): string => {
  if (total === 0) return "0% of events";
  return `${Math.round((count / total) * 100)}% of events`;
};

const toTwoDigitString = (value: number): string => {
  return String(value).padStart(2, "0");
};

const toDayKey = (date: Date): string => {
  return `${date.getFullYear()}-${toTwoDigitString(date.getMonth() + 1)}-${toTwoDigitString(date.getDate())}`;
};

const toHourKey = (date: Date): string => {
  return `${toDayKey(date)}T${toTwoDigitString(date.getHours())}`;
};

const formatFilterDate = (dayKey: string): string => {
  const parsed = new Date(`${dayKey}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return dayKey;
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(parsed);
};

const formatHourLabel = (hourKey: string): string => {
  const [rawDayKey, hourPart = "00"] = hourKey.split("T");
  const dayKey = rawDayKey ?? hourKey;
  return `${formatFilterDate(dayKey)}, ${hourPart}:00`;
};

const formatMethodLabel = (method: MethodFilter): string => {
  return METHOD_LABELS[method];
};

const applyMethodFilter = (
  telemetry: readonly PaymentTelemetryEvent[],
  method: MethodFilter | null,
): PaymentTelemetryEvent[] => {
  if (!method || method === ALL_METHODS_VALUE) {
    return [...telemetry];
  }

  return telemetry.filter((item) => item.method === method);
};

const applyMintFilter = (
  telemetry: readonly PaymentTelemetryEvent[],
  mint: string | null,
): PaymentTelemetryEvent[] => {
  if (mint === null) {
    return [...telemetry];
  }

  if (mint === UNKNOWN_MINT_FILTER_VALUE) {
    return telemetry.filter((item) => item.mint === null);
  }

  return telemetry.filter((item) => item.mint === mint);
};

const formatMintLabel = (mint: string | null): string => {
  if (!mint) return "Unknown mint";

  try {
    const url = new URL(mint);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return mint;
  }
};

const polarToCartesian = (
  centerX: number,
  centerY: number,
  radius: number,
  angleRad: number,
) => {
  return {
    x: centerX + radius * Math.cos(angleRad),
    y: centerY + radius * Math.sin(angleRad),
  };
};

const buildPieSlicePath = (
  centerX: number,
  centerY: number,
  radius: number,
  startAngleRad: number,
  endAngleRad: number,
): string => {
  const start = polarToCartesian(centerX, centerY, radius, startAngleRad);
  const end = polarToCartesian(centerX, centerY, radius, endAngleRad);
  const largeArcFlag = endAngleRad - startAngleRad > Math.PI ? 1 : 0;

  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
};

const Avatar = ({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string | null;
}) => {
  if (imageUrl) {
    return (
      <div className="account-avatar account-avatar-image">
        <img
          alt={name ?? "Nostr profile"}
          className="avatar-image"
          src={imageUrl}
        />
      </div>
    );
  }

  return (
    <div
      aria-label="Account avatar placeholder"
      className="account-avatar account-avatar-placeholder"
      role="img"
    >
      <span className="avatar-orb avatar-orb-large" />
      <span className="avatar-orb avatar-orb-small" />
    </div>
  );
};

const Chart = ({
  activeBucketKey,
  onBucketClick,
  series,
}: {
  activeBucketKey: string | null;
  onBucketClick: (item: DailySeriesItem) => void;
  series: readonly DailySeriesItem[];
}) => {
  const chartHeight = 280;
  const isHourly = series[0]?.bucketKind === "hour";
  const groupWidth = isHourly ? 34 : 58;
  const chartWidth = Math.max(series.length * groupWidth + 80, 420);
  const maxValue = Math.max(
    1,
    ...series.map((item) => Math.max(item.successCount, item.errorCount)),
  );
  const usableHeight = 180;
  const baselineY = 215;
  const gridValues = [0, Math.ceil(maxValue / 2), maxValue];

  return (
    <svg
      aria-label="Payment outcomes per day"
      className="chart-svg"
      role="img"
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
    >
      <defs>
        <linearGradient id="successBar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#7dd3a5" />
          <stop offset="100%" stopColor="#21704e" />
        </linearGradient>
        <linearGradient id="errorBar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ff6f61" />
          <stop offset="100%" stopColor="#b42318" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => {
        const y = baselineY - (value / maxValue) * usableHeight;
        return (
          <g key={value}>
            <line
              className="chart-grid-line"
              x1="28"
              x2={chartWidth - 18}
              y1={y}
              y2={y}
            />
            <text className="chart-grid-label" x="6" y={y + 4}>
              {value}
            </text>
          </g>
        );
      })}

      {series.map((item, index) => {
        const groupX = 44 + index * groupWidth;
        const successX = isHourly ? groupX : groupX;
        const errorX = isHourly ? groupX + 12 : groupX + 22;
        const barWidth = isHourly ? 10 : 18;
        const successHeight = (item.successCount / maxValue) * usableHeight;
        const errorHeight = (item.errorCount / maxValue) * usableHeight;
        const isActive = activeBucketKey === item.dayKey;

        return (
          <g
            aria-label={`Filter by ${item.label}`}
            className={
              isActive
                ? "chart-bar-group chart-bar-group-active"
                : "chart-bar-group"
            }
            key={item.dayKey}
            onClick={() => onBucketClick(item)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onBucketClick(item);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <rect
              className="chart-hit-area"
              height={usableHeight + 42}
              rx="12"
              width={isHourly ? 24 : 42}
              x={groupX - 6}
              y={baselineY - usableHeight - 8}
            />
            <rect
              fill="url(#successBar)"
              height={successHeight}
              rx="8"
              width={barWidth}
              x={successX}
              y={baselineY - successHeight}
            />
            <rect
              fill="url(#errorBar)"
              height={errorHeight}
              rx="8"
              width={barWidth}
              x={errorX}
              y={baselineY - errorHeight}
            />
            <text
              className="chart-count-label"
              x={successX + barWidth / 2}
              y={baselineY - successHeight - 8}
            >
              {item.successCount}
            </text>
            <text
              className="chart-count-label"
              x={errorX + barWidth / 2}
              y={baselineY - errorHeight - 8}
            >
              {item.errorCount}
            </text>
            <text
              className={
                isHourly ? "chart-x-label chart-x-label-hour" : "chart-x-label"
              }
              x={groupX + (isHourly ? 11 : 20)}
              y="246"
            >
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const MintChart = ({
  activeMintKey,
  onMintClick,
  series,
}: {
  activeMintKey: string | null;
  onMintClick: (mint: string | null) => void;
  series: readonly MintSeriesItem[];
}) => {
  if (series.length === 0) {
    return (
      <div className="empty-panel">
        <h3>No mint chart data in the selected range</h3>
        <p>The current filter combination has no success or error events.</p>
      </div>
    );
  }

  const chartWidth = 760;
  const rowHeight = 56;
  const chartHeight = Math.max(series.length * rowHeight + 32, 180);
  const labelWidth = 190;
  const chartStartX = labelWidth + 24;
  const chartUsableWidth = chartWidth - chartStartX - 54;
  const maxValue = Math.max(
    1,
    ...series.map((item) => Math.max(item.successCount, item.errorCount)),
  );
  const gridValues = [0, Math.ceil(maxValue / 2), maxValue];

  return (
    <svg
      aria-label="Payment outcomes by mint"
      className="chart-svg"
      role="img"
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
    >
      <defs>
        <linearGradient id="mintSuccessBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7dd3a5" />
          <stop offset="100%" stopColor="#21704e" />
        </linearGradient>
        <linearGradient id="mintErrorBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ff6f61" />
          <stop offset="100%" stopColor="#b42318" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => {
        const x = chartStartX + (value / maxValue) * chartUsableWidth;
        return (
          <g key={value}>
            <line
              className="chart-grid-line"
              x1={x}
              x2={x}
              y1="12"
              y2={chartHeight - 18}
            />
            <text className="chart-grid-label" x={x} y="12">
              {value}
            </text>
          </g>
        );
      })}

      {series.map((item, index) => {
        const rowTop = 28 + index * rowHeight;
        const labelY = rowTop + 14;
        const successY = rowTop + 2;
        const errorY = rowTop + 24;
        const successWidth = (item.successCount / maxValue) * chartUsableWidth;
        const errorWidth = (item.errorCount / maxValue) * chartUsableWidth;
        const label = formatMintLabel(item.mint);
        const mintKey = item.mint ?? UNKNOWN_MINT_FILTER_VALUE;
        const isActive = activeMintKey === mintKey;

        return (
          <g
            aria-label={`Filter by mint ${label}`}
            className={
              isActive
                ? "mint-chart-row mint-chart-row-active"
                : "mint-chart-row"
            }
            key={item.mint ?? "__unknown__"}
            onClick={() => onMintClick(item.mint)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onMintClick(item.mint);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <rect
              className="mint-chart-hit-area"
              height="42"
              rx="12"
              width={chartWidth}
              x="0"
              y={rowTop - 8}
            />
            <text className="mint-chart-label" x="0" y={labelY}>
              {label}
            </text>
            <rect
              className="mint-chart-track"
              height="14"
              rx="7"
              width={chartUsableWidth}
              x={chartStartX}
              y={successY}
            />
            <rect
              className="mint-chart-track"
              height="14"
              rx="7"
              width={chartUsableWidth}
              x={chartStartX}
              y={errorY}
            />
            <rect
              fill="url(#mintSuccessBar)"
              height="14"
              rx="7"
              width={successWidth}
              x={chartStartX}
              y={successY}
            />
            <rect
              fill="url(#mintErrorBar)"
              height="14"
              rx="7"
              width={errorWidth}
              x={chartStartX}
              y={errorY}
            />
            <text
              className="chart-count-label mint-chart-count"
              x={chartStartX + successWidth + 10}
              y={successY + 11}
            >
              {item.successCount}
            </text>
            <text
              className="chart-count-label mint-chart-count"
              x={chartStartX + errorWidth + 10}
              y={errorY + 11}
            >
              {item.errorCount}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const MethodChart = ({
  activeMethod,
  onMethodClick,
  series,
}: {
  activeMethod: MethodFilter | null;
  onMethodClick: (method: MethodFilter) => void;
  series: readonly MethodSeriesItem[];
}) => {
  if (series.length === 0) {
    return (
      <div className="empty-panel">
        <h3>No method chart data in the selected range</h3>
        <p>The current filter combination has no success or error events.</p>
      </div>
    );
  }

  const chartWidth = 760;
  const rowHeight = 56;
  const chartHeight = Math.max(series.length * rowHeight + 32, 180);
  const labelWidth = 190;
  const chartStartX = labelWidth + 24;
  const chartUsableWidth = chartWidth - chartStartX - 54;
  const maxValue = Math.max(
    1,
    ...series.map((item) => Math.max(item.successCount, item.errorCount)),
  );
  const gridValues = [0, Math.ceil(maxValue / 2), maxValue];

  return (
    <svg
      aria-label="Payment outcomes by method"
      className="chart-svg"
      role="img"
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
    >
      <defs>
        <linearGradient id="methodSuccessBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#7dd3a5" />
          <stop offset="100%" stopColor="#21704e" />
        </linearGradient>
        <linearGradient id="methodErrorBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#ff6f61" />
          <stop offset="100%" stopColor="#b42318" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => {
        const x = chartStartX + (value / maxValue) * chartUsableWidth;
        return (
          <g key={value}>
            <line
              className="chart-grid-line"
              x1={x}
              x2={x}
              y1="12"
              y2={chartHeight - 18}
            />
            <text className="chart-grid-label" x={x} y="12">
              {value}
            </text>
          </g>
        );
      })}

      {series.map((item, index) => {
        const rowTop = 28 + index * rowHeight;
        const labelY = rowTop + 14;
        const successY = rowTop + 2;
        const errorY = rowTop + 24;
        const successWidth = (item.successCount / maxValue) * chartUsableWidth;
        const errorWidth = (item.errorCount / maxValue) * chartUsableWidth;
        const isActive = activeMethod === item.method;

        return (
          <g
            aria-label={`Filter by method ${formatMethodLabel(item.method)}`}
            className={
              isActive
                ? "method-chart-row method-chart-row-active"
                : "method-chart-row"
            }
            key={item.method}
            onClick={() => onMethodClick(item.method)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onMethodClick(item.method);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <rect
              className="method-chart-hit-area"
              height="42"
              rx="12"
              width={chartWidth}
              x="0"
              y={rowTop - 8}
            />
            <text className="method-chart-label" x="0" y={labelY}>
              {formatMethodLabel(item.method)}
            </text>
            <rect
              className="method-chart-track"
              height="14"
              rx="7"
              width={chartUsableWidth}
              x={chartStartX}
              y={successY}
            />
            <rect
              className="method-chart-track"
              height="14"
              rx="7"
              width={chartUsableWidth}
              x={chartStartX}
              y={errorY}
            />
            <rect
              fill="url(#methodSuccessBar)"
              height="14"
              rx="7"
              width={successWidth}
              x={chartStartX}
              y={successY}
            />
            <rect
              fill="url(#methodErrorBar)"
              height="14"
              rx="7"
              width={errorWidth}
              x={chartStartX}
              y={errorY}
            />
            <text
              className="chart-count-label method-chart-count"
              x={chartStartX + successWidth + 10}
              y={successY + 11}
            >
              {item.successCount}
            </text>
            <text
              className="chart-count-label method-chart-count"
              x={chartStartX + errorWidth + 10}
              y={errorY + 11}
            >
              {item.errorCount}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const SnapshotPie = ({
  declinedCount,
  errorCount,
  successCount,
  totalCount,
}: {
  declinedCount: number;
  errorCount: number;
  successCount: number;
  totalCount: number;
}) => {
  if (totalCount === 0) {
    return (
      <div className="empty-panel">
        <h3>No events in the selected range</h3>
        <p>Adjust the active filters to see payment outcome ratios.</p>
      </div>
    );
  }

  const slices = [
    { color: "#63efaf", count: successCount, key: "ok", label: "Successful" },
    {
      color: "#f6c453",
      count: declinedCount,
      key: "declined",
      label: "Declined",
    },
    { color: "#ff6f61", count: errorCount, key: "error", label: "Errors" },
  ].filter((item) => item.count > 0);

  const centerX = 110;
  const centerY = 110;
  const radius = 88;
  let cursor = -Math.PI / 2;

  return (
    <div className="snapshot-pie-wrap">
      <svg
        aria-label="Payment outcome share"
        className="snapshot-pie-svg"
        role="img"
        viewBox="0 0 220 220"
      >
        {slices.map((slice) => {
          const angle = (slice.count / totalCount) * Math.PI * 2;
          const startAngle = cursor;
          const endAngle = cursor + angle;
          cursor = endAngle;
          const labelAngle = startAngle + angle / 2;
          const labelPosition = polarToCartesian(
            centerX,
            centerY,
            radius * 0.62,
            labelAngle,
          );

          return (
            <g key={slice.key}>
              <path
                d={buildPieSlicePath(
                  centerX,
                  centerY,
                  radius,
                  startAngle,
                  endAngle,
                )}
                fill={slice.color}
              />
              <text
                className="snapshot-pie-label"
                x={labelPosition.x}
                y={labelPosition.y}
              >
                {formatShare(slice.count, totalCount).replace(" of events", "")}
              </text>
            </g>
          );
        })}
        <circle
          className="snapshot-pie-center"
          cx={centerX}
          cy={centerY}
          r="38"
        />
        <text className="snapshot-pie-total-value" x={centerX} y="116">
          {totalCount}
        </text>
      </svg>

      <div className="snapshot-breakdown">
        <div className="snapshot-breakdown-row">
          <span className="snapshot-breakdown-label">
            <span className="snapshot-breakdown-dot snapshot-breakdown-dot-success" />
            Successful
          </span>
          <strong>{successCount}</strong>
        </div>
        <div className="snapshot-breakdown-row">
          <span className="snapshot-breakdown-label">
            <span className="snapshot-breakdown-dot snapshot-breakdown-dot-declined" />
            Declined
          </span>
          <strong>{declinedCount}</strong>
        </div>
        <div className="snapshot-breakdown-row">
          <span className="snapshot-breakdown-label">
            <span className="snapshot-breakdown-dot snapshot-breakdown-dot-error" />
            Errors
          </span>
          <strong>{errorCount}</strong>
        </div>
      </div>
    </div>
  );
};

const ErrorSummary = ({ items }: { items: readonly ErrorSummaryItem[] }) => {
  if (items.length === 0) {
    return (
      <div className="empty-panel">
        <h3>No errors in the selected range</h3>
        <p>
          The currently visible telemetry does not contain any non-empty
          `errorCode` values.
        </p>
      </div>
    );
  }

  return (
    <div className="error-list">
      {items.map((item) => (
        <details className="error-row" key={item.errorCode}>
          <summary className="error-row-summary">
            <div>
              <p className="error-code">{item.errorCode}</p>
              <p className="error-caption">
                {item.details.length > 0
                  ? "Expand to inspect errorDetail values"
                  : "No errorDetail values attached"}
              </p>
            </div>
            <span className="error-count">{item.count}</span>
          </summary>

          <div className="error-detail-list">
            {item.details.length > 0 ? (
              item.details.map((detail) => (
                <div
                  className="error-detail-row"
                  key={`${item.errorCode}-${detail.errorDetail ?? "empty"}`}
                >
                  <p className="error-detail-text">
                    {detail.errorDetail ?? "No errorDetail value"}
                  </p>
                  <span className="error-detail-count">{detail.count}</span>
                </div>
              ))
            ) : (
              <div className="error-detail-row error-detail-row-empty">
                <p className="error-detail-text">No errorDetail value</p>
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
};

export default function App() {
  const [seedInput, setSeedInput] = useState("");
  const [identity, setIdentity] = useState<DerivedIdentity | null>(null);
  const [profile, setProfile] = useState<AccountProfileState>({
    imageUrl: null,
    name: null,
  });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>("7d");
  const [selectedMethod, setSelectedMethod] = useState<MethodFilter>("all");
  const [selectedMint, setSelectedMint] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedHour, setSelectedHour] = useState("");
  const [hydratedFromCache, setHydratedFromCache] = useState(false);

  const deferredDate = useDeferredValue(selectedDate);
  const deferredHour = useDeferredValue(selectedHour);
  const deferredMethod = useDeferredValue(selectedMethod);
  const deferredMint = useDeferredValue(selectedMint);
  const telemetry = dashboard?.telemetryEvents ?? [];
  const timeRangeTelemetry = filterTelemetryEvents({
    date: deferredDate || null,
    method: ALL_METHODS_VALUE,
    period: selectedPeriod,
    telemetry,
  });
  const selectedMintValue =
    deferredMint === UNKNOWN_MINT_FILTER_VALUE
      ? UNKNOWN_MINT_FILTER_VALUE
      : deferredMint || null;
  const selectedMethodValue =
    deferredMethod === ALL_METHODS_VALUE ? null : deferredMethod;
  const hourFilteredTelemetry = timeRangeTelemetry.filter((item) => {
    if (!deferredHour) return true;
    return toHourKey(new Date(item.createdAtSec * 1000)) === deferredHour;
  });
  const timeChartTelemetry = applyMintFilter(
    applyMethodFilter(timeRangeTelemetry, selectedMethodValue),
    selectedMintValue,
  );
  const methodChartTelemetry = applyMintFilter(
    hourFilteredTelemetry,
    selectedMintValue,
  );
  const mintChartTelemetry = applyMethodFilter(
    hourFilteredTelemetry,
    selectedMethodValue,
  );
  const filteredTelemetry = applyMintFilter(
    applyMethodFilter(hourFilteredTelemetry, selectedMethodValue),
    selectedMintValue,
  );
  const dailySeries = buildDailySeries({
    date: deferredDate || null,
    period: selectedPeriod,
    telemetry: timeChartTelemetry,
  });
  const errorSummary = buildErrorSummary(filteredTelemetry);
  const mintSeries = buildMintSeries(mintChartTelemetry);
  const methodSeries = buildMethodSeries(methodChartTelemetry);
  const totalEventCount = filteredTelemetry.length;
  const successCount = filteredTelemetry.filter(
    (item) => item.status === "ok",
  ).length;
  const declinedCount = filteredTelemetry.filter(
    (item) => item.status === "declined",
  ).length;
  const errorCount = filteredTelemetry.filter(
    (item) => item.status === "error",
  ).length;

  const activeTimeBucketKey = deferredHour || deferredDate || null;
  const activeMintKey = deferredMint || null;
  const activeMethod =
    deferredMethod === ALL_METHODS_VALUE ? null : deferredMethod;

  function handleTimeBucketClick(item: DailySeriesItem) {
    if (item.bucketKind === "day") {
      setSelectedHour("");
      setSelectedDate((current) =>
        current === item.dayKey ? "" : item.dayKey,
      );
      return;
    }

    const nextDayKey = item.dayKey.slice(0, 10);
    setSelectedDate(nextDayKey);
    setSelectedHour((current) => (current === item.dayKey ? "" : item.dayKey));
  }

  function handleMintChartClick(mint: string | null) {
    const nextValue = mint ?? UNKNOWN_MINT_FILTER_VALUE;
    setSelectedMint((current) => (current === nextValue ? "" : nextValue));
  }

  function handleMethodChartClick(method: MethodFilter) {
    setSelectedMethod((current) =>
      current === method ? ALL_METHODS_VALUE : method,
    );
  }

  function clearDateFilter() {
    setSelectedDate("");
    setSelectedHour("");
  }

  function clearHourFilter() {
    setSelectedHour("");
  }

  function clearMintFilter() {
    setSelectedMint("");
  }

  function clearMethodFilter() {
    setSelectedMethod(ALL_METHODS_VALUE);
  }

  function handlePeriodChange(period: PeriodFilter) {
    setSelectedPeriod(period);
    setSelectedDate("");
    setSelectedHour("");
  }

  function persistCurrentSession(args: {
    activeIdentity: DerivedIdentity;
    dashboardSnapshot?: DashboardSnapshot | null;
    profileSnapshot?: AccountProfileState;
    seed: string;
  }) {
    persistSession({
      dashboard: args.dashboardSnapshot ?? dashboard,
      profile: args.profileSnapshot ?? profile,
      publicKeyHex: args.activeIdentity.publicKeyHex,
      seed: args.seed,
    });
  }

  async function loadProfile(
    activeIdentity: DerivedIdentity,
    seed: string,
    dashboardSnapshot?: DashboardSnapshot | null,
    relayUrls?: readonly string[],
  ) {
    try {
      const nextProfile = await fetchAccountProfile(
        relayUrls
          ? {
              publicKeyHex: activeIdentity.publicKeyHex,
              relayUrls,
            }
          : {
              publicKeyHex: activeIdentity.publicKeyHex,
            },
      );
      setProfile(nextProfile);
      persistCurrentSession({
        activeIdentity,
        profileSnapshot: nextProfile,
        seed,
        ...(dashboardSnapshot !== undefined ? { dashboardSnapshot } : {}),
      });
    } catch {
      const emptyProfile = { imageUrl: null, name: null };
      setProfile(emptyProfile);
      persistCurrentSession({
        activeIdentity,
        profileSnapshot: emptyProfile,
        seed,
        ...(dashboardSnapshot !== undefined ? { dashboardSnapshot } : {}),
      });
    }
  }

  async function refreshTelemetry(
    nextIdentity?: DerivedIdentity,
    nextSeed?: string,
  ) {
    const activeIdentity = nextIdentity ?? identity;
    const activeSeed = nextSeed ?? seedInput;

    if (!activeIdentity) {
      setErrorMessage("Missing collector identity.");
      setLoadPhase("error");
      return;
    }

    setLoadPhase("loading");
    setErrorMessage(null);

    try {
      const result = await fetchTelemetryForCollector({
        privateKeyBytes: activeIdentity.privateKeyBytes,
        publicKeyHex: activeIdentity.publicKeyHex,
      });

      const nextDashboard: DashboardSnapshot = {
        fetchedWrapCount: result.fetchedWrapCount,
        ignoredWrapCount: result.ignoredWrapCount,
        lastFetchedAtMs: Date.now(),
        relayUrls: result.relayUrls,
        telemetryEvents: result.telemetryEvents,
      };

      startTransition(() => {
        setDashboard(nextDashboard);
        setLoadPhase("ready");
      });
      persistCurrentSession({
        activeIdentity,
        dashboardSnapshot: nextDashboard,
        seed: activeSeed,
      });
      setHydratedFromCache(false);
      await loadProfile(
        activeIdentity,
        activeSeed,
        nextDashboard,
        result.relayUrls,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Telemetry fetch failed.";
      setErrorMessage(message);
      setLoadPhase("error");
    }
  }

  const restoreSession = useEffectEvent(async () => {
    const persistedSession = readPersistedSession();
    if (!persistedSession?.seed) {
      setHydratedFromCache(true);
      return;
    }

    setSeedInput(persistedSession.seed);
    setLoadPhase("authenticating");
    setErrorMessage(null);

    const restoredIdentity = await deriveIdentityFromSlip39(
      persistedSession.seed,
    );
    if (!restoredIdentity) {
      clearPersistedSession();
      setSeedInput("");
      setLoadPhase("idle");
      setHydratedFromCache(true);
      setErrorMessage("Saved session could not be restored. Log in again.");
      return;
    }

    setIdentity(restoredIdentity);
    if (persistedSession.publicKeyHex === restoredIdentity.publicKeyHex) {
      setProfile(persistedSession.profile);

      if (persistedSession.dashboard) {
        setDashboard(persistedSession.dashboard);
        setLoadPhase("ready");
        setHydratedFromCache(true);
        void refreshTelemetry(restoredIdentity, persistedSession.seed);
        return;
      }
    } else {
      persistCurrentSession({
        activeIdentity: restoredIdentity,
        dashboardSnapshot: null,
        profileSnapshot: { imageUrl: null, name: null },
        seed: persistedSession.seed,
      });
    }

    setProfile({ imageUrl: null, name: null });
    setHydratedFromCache(true);
    await refreshTelemetry(restoredIdentity, persistedSession.seed);
  });

  useEffect(() => {
    void restoreSession();
  }, []);

  async function submitLogin() {
    const normalized = normalizeSlip39Seed(seedInput);
    setSeedInput(normalized);

    if (!normalized) {
      setErrorMessage("Paste the SLIP-39 seed for the collector account.");
      setLoadPhase("error");
      return;
    }

    if (!looksLikeSlip39Seed(normalized)) {
      setErrorMessage("This does not look like a valid SLIP-39 share.");
      setLoadPhase("error");
      return;
    }

    setLoadPhase("authenticating");
    setErrorMessage(null);

    const nextIdentity = await deriveIdentityFromSlip39(normalized);
    if (!nextIdentity) {
      setErrorMessage("Seed derivation failed. Check the words and try again.");
      setLoadPhase("error");
      return;
    }

    const persistedSession = readPersistedSession();
    const cachedSession =
      persistedSession?.publicKeyHex === nextIdentity.publicKeyHex
        ? persistedSession
        : null;

    setIdentity(nextIdentity);
    setProfile(cachedSession?.profile ?? { imageUrl: null, name: null });
    setDashboard(cachedSession?.dashboard ?? null);
    setHydratedFromCache(Boolean(cachedSession?.dashboard));

    persistCurrentSession({
      activeIdentity: nextIdentity,
      dashboardSnapshot: cachedSession?.dashboard ?? null,
      profileSnapshot: cachedSession?.profile ?? { imageUrl: null, name: null },
      seed: normalized,
    });

    if (cachedSession?.dashboard) {
      setLoadPhase("ready");
      return;
    }

    await refreshTelemetry(nextIdentity, normalized);
  }

  function handleLogout() {
    setAccountMenuOpen(false);
    clearPersistedSession();
    setIdentity(null);
    setProfile({ imageUrl: null, name: null });
    setDashboard(null);
    setSeedInput("");
    setSelectedDate("");
    setSelectedHour("");
    setSelectedMint("");
    setSelectedMethod("all");
    setSelectedPeriod("7d");
    setErrorMessage(null);
    setLoadPhase("idle");
  }

  return (
    <main className="app-shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <section className="hero-card">
        <div
          className={
            identity ? "hero-layout hero-layout-compact" : "hero-layout"
          }
        >
          <div className="hero-copy-wrap">
            <p className="eyebrow">Internal analytics</p>
            <h1>Nostr dashboard</h1>
          </div>

          <aside
            className={
              identity ? "login-card login-card-compact" : "login-card"
            }
          >
            {identity ? (
              <div className="login-card-avatar">
                <div className="account-menu-wrap">
                  <button
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    className="avatar-button"
                    onClick={() => setAccountMenuOpen((current) => !current)}
                    type="button"
                  >
                    <Avatar imageUrl={profile.imageUrl} name={profile.name} />
                  </button>
                  {accountMenuOpen ? (
                    <div className="account-menu" role="menu">
                      <button
                        className="account-menu-item"
                        onClick={handleLogout}
                        type="button"
                      >
                        Logout
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="login-card-head">
                  <div>
                    <p className="eyebrow">Account</p>
                    <h2>Login</h2>
                  </div>
                  <Avatar imageUrl={null} name={null} />
                </div>

                <form action={submitLogin} className="login-form">
                  <label className="field-label" htmlFor="slip39-seed">
                    Collector SLIP-39 seed
                  </label>
                  <textarea
                    className="seed-textarea"
                    id="slip39-seed"
                    onChange={(event) => setSeedInput(event.target.value)}
                    placeholder="humidity guest academic ..."
                    rows={4}
                    spellCheck={false}
                    value={seedInput}
                  />
                  <div className="action-row">
                    <button
                      className="primary-button"
                      disabled={
                        loadPhase === "authenticating" ||
                        loadPhase === "loading"
                      }
                      type="submit"
                    >
                      {loadPhase === "authenticating"
                        ? "Deriving account..."
                        : "Login and load telemetry"}
                    </button>
                  </div>
                </form>
              </>
            )}

            {!identity && errorMessage ? (
              <p className="error-banner">{errorMessage}</p>
            ) : null}
          </aside>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-wide">
          <div className="panel-head">
            <p className="eyebrow">Chart</p>
          </div>

          <div className="filters-row">
            <div className="pill-group">
              {PERIOD_FILTERS.map((period) => (
                <button
                  className={
                    period === selectedPeriod ? "pill pill-active" : "pill"
                  }
                  key={period}
                  onClick={() => handlePeriodChange(period)}
                  type="button"
                >
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>
          </div>

          <div className="active-filter-row">
            <span className="active-filter-hint">
              Click a day to drill into hours, then click an hour to isolate
              that slot. Click the same item again to clear it.
            </span>
            {selectedDate ? (
              <button
                className="active-filter-chip active-filter-chip-button"
                onClick={clearDateFilter}
                type="button"
              >
                Day: {formatFilterDate(selectedDate)}
              </button>
            ) : null}
            {selectedHour ? (
              <button
                className="active-filter-chip active-filter-chip-button"
                onClick={clearHourFilter}
                type="button"
              >
                Hour: {formatHourLabel(selectedHour)}
              </button>
            ) : null}
            {selectedMint ? (
              <button
                className="active-filter-chip active-filter-chip-button"
                onClick={clearMintFilter}
                type="button"
              >
                Mint:{" "}
                {selectedMint === UNKNOWN_MINT_FILTER_VALUE
                  ? "Unknown mint"
                  : formatMintLabel(selectedMint)}
              </button>
            ) : null}
            {selectedMethod !== ALL_METHODS_VALUE ? (
              <button
                className="active-filter-chip active-filter-chip-button"
                onClick={clearMethodFilter}
                type="button"
              >
                Method: {formatMethodLabel(selectedMethod)}
              </button>
            ) : null}
          </div>

          <div className="chart-shell">
            <Chart
              activeBucketKey={activeTimeBucketKey}
              onBucketClick={handleTimeBucketClick}
              series={dailySeries}
            />
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Events</p>
            </div>
          </div>

          <SnapshotPie
            declinedCount={declinedCount}
            errorCount={errorCount}
            successCount={successCount}
            totalCount={totalEventCount}
          />

          {dashboard ? (
            <div className="snapshot-meta">
              <div className="snapshot-meta-row">
                <span>Error codes</span>
                <strong>{errorSummary.length}</strong>
              </div>
              <div className="snapshot-meta-row">
                <span>Wraps fetched</span>
                <strong>{dashboard.fetchedWrapCount}</strong>
              </div>
              <div className="snapshot-meta-row">
                <span>Ignored wraps</span>
                <strong>{dashboard.ignoredWrapCount}</strong>
              </div>
            </div>
          ) : (
            <div className="empty-panel">
              <h3>No telemetry loaded yet</h3>
              <p>
                After login the dashboard will fetch and decrypt gift wraps.
              </p>
            </div>
          )}
        </article>

        <article className="panel panel-wide">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Method chart</p>
            </div>
          </div>

          <div className="chart-shell">
            <div className="chart-scroll-wrap">
              <MethodChart
                activeMethod={activeMethod}
                onMethodClick={handleMethodChartClick}
                series={methodSeries}
              />
            </div>
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Mint chart</p>
            </div>
          </div>

          <div className="chart-shell">
            <div className="chart-scroll-wrap">
              <MintChart
                activeMintKey={activeMintKey}
                onMintClick={handleMintChartClick}
                series={mintSeries}
              />
            </div>
          </div>
        </article>

        <article className="panel panel-wide">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Error summary</p>
            </div>
          </div>
          <ErrorSummary items={errorSummary} />
        </article>
      </section>

      {identity && dashboard ? (
        <section className="page-sync-footer">
          <p className="page-sync-text">
            {hydratedFromCache ? "Cached sync" : "Last sync"}{" "}
            {formatTimestamp(dashboard.lastFetchedAtMs)}
          </p>
          <button
            className="page-sync-refresh"
            disabled={loadPhase === "loading"}
            onClick={() => {
              setHydratedFromCache(false);
              void refreshTelemetry();
            }}
            type="button"
          >
            {loadPhase === "loading" ? "Refreshing..." : "Refresh"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
