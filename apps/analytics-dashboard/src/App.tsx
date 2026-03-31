import {
  startTransition,
  useDeferredValue,
  useState,
  type FormEvent,
} from "react";
import {
  deriveIdentityFromSlip39,
  looksLikeSlip39Seed,
  normalizeSlip39Seed,
  type DerivedIdentity,
} from "./lib/identity";
import { fetchTelemetryForCollector } from "./lib/nostr";
import {
  buildDailySeries,
  buildErrorSummary,
  buildMethodOptions,
  filterTelemetryEvents,
  formatShortNpub,
  isMethodFilter,
  PERIOD_FILTERS,
  type DailySeriesItem,
  type ErrorSummaryItem,
  type MethodFilter,
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

const formatTimestamp = (timestampMs: number): string => {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
};

const Chart = ({ series }: { series: readonly DailySeriesItem[] }) => {
  const chartHeight = 280;
  const chartWidth = Math.max(series.length * 58, 420);
  const maxValue = Math.max(
    1,
    ...series.map((item) => Math.max(item.successCount, item.errorCount)),
  );
  const usableHeight = 180;
  const baselineY = 215;
  const gridValues = [0, Math.ceil(maxValue / 2), maxValue];

  return (
    <div className="chart-shell">
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
            <stop offset="0%" stopColor="#ff9d7f" />
            <stop offset="100%" stopColor="#a33c2c" />
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
          const groupX = 44 + index * 58;
          const successHeight = (item.successCount / maxValue) * usableHeight;
          const errorHeight = (item.errorCount / maxValue) * usableHeight;

          return (
            <g key={item.dayKey}>
              <rect
                fill="url(#successBar)"
                height={successHeight}
                rx="8"
                width="18"
                x={groupX}
                y={baselineY - successHeight}
              />
              <rect
                fill="url(#errorBar)"
                height={errorHeight}
                rx="8"
                width="18"
                x={groupX + 22}
                y={baselineY - errorHeight}
              />
              <text
                className="chart-count-label"
                x={groupX + 9}
                y={baselineY - successHeight - 8}
              >
                {item.successCount}
              </text>
              <text
                className="chart-count-label"
                x={groupX + 31}
                y={baselineY - errorHeight - 8}
              >
                {item.errorCount}
              </text>
              <text className="chart-x-label" x={groupX + 20} y="246">
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="legend-chip">
          <span className="legend-dot legend-dot-success" />
          Successful payments
        </span>
        <span className="legend-chip">
          <span className="legend-dot legend-dot-error" />
          Errors
        </span>
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
        <div className="error-row" key={item.errorCode}>
          <div>
            <p className="error-code">{item.errorCode}</p>
            <p className="error-caption">Reported payment error</p>
          </div>
          <span className="error-count">{item.count}</span>
        </div>
      ))}
    </div>
  );
};

export default function App() {
  const [seedInput, setSeedInput] = useState("");
  const [identity, setIdentity] = useState<DerivedIdentity | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>("7d");
  const [selectedMethod, setSelectedMethod] = useState<MethodFilter>("all");

  const deferredMethod = useDeferredValue(selectedMethod);
  const telemetry = dashboard?.telemetryEvents ?? [];
  const methodOptions = buildMethodOptions(telemetry);
  const filteredTelemetry = filterTelemetryEvents({
    method: deferredMethod,
    period: selectedPeriod,
    telemetry,
  });
  const dailySeries = buildDailySeries({
    period: selectedPeriod,
    telemetry: filteredTelemetry,
  });
  const errorSummary = buildErrorSummary(filteredTelemetry);
  const successCount = filteredTelemetry.filter(
    (item) => item.status === "ok",
  ).length;
  const errorCount = filteredTelemetry.filter(
    (item) => item.status === "error",
  ).length;

  async function refreshTelemetry(nextIdentity?: DerivedIdentity) {
    const activeIdentity = nextIdentity ?? identity;

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

      startTransition(() => {
        setDashboard({
          fetchedWrapCount: result.fetchedWrapCount,
          ignoredWrapCount: result.ignoredWrapCount,
          lastFetchedAtMs: Date.now(),
          relayUrls: result.relayUrls,
          telemetryEvents: result.telemetryEvents,
        });
        setLoadPhase("ready");
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Telemetry fetch failed.";
      setErrorMessage(message);
      setLoadPhase("error");
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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

    setIdentity(nextIdentity);
    await refreshTelemetry(nextIdentity);
  }

  function handleLogout() {
    setIdentity(null);
    setDashboard(null);
    setSeedInput("");
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
        <p className="eyebrow">Internal analytics</p>
        <h1>Linky payment telemetry dashboard</h1>
        <p className="hero-copy">
          Sign in with the collector&apos;s SLIP-39 seed. The dashboard derives
          the exact same Nostr account as Linky and reads wrapped payment
          telemetry from that inbox.
        </p>

        {!identity ? (
          <form
            className="login-form"
            onSubmit={(event) => {
              void submitLogin(event);
            }}
          >
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
                  loadPhase === "authenticating" || loadPhase === "loading"
                }
                type="submit"
              >
                {loadPhase === "authenticating"
                  ? "Deriving account..."
                  : "Login and load telemetry"}
              </button>
            </div>
          </form>
        ) : (
          <div className="identity-panel">
            <div>
              <p className="field-label">Signed in collector account</p>
              <p className="identity-value">{formatShortNpub(identity.npub)}</p>
            </div>
            <div className="action-row">
              <button
                className="primary-button"
                disabled={loadPhase === "loading"}
                onClick={() => {
                  void refreshTelemetry();
                }}
                type="button"
              >
                {loadPhase === "loading"
                  ? "Refreshing..."
                  : "Refresh telemetry"}
              </button>
              <button
                className="ghost-button"
                onClick={handleLogout}
                type="button"
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-wide">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Filters</p>
              <h2>Payment outcomes over time</h2>
            </div>
            {dashboard ? (
              <p className="panel-meta">
                Last sync {formatTimestamp(dashboard.lastFetchedAtMs)}
              </p>
            ) : null}
          </div>

          <div className="filters-row">
            <div className="pill-group">
              {PERIOD_FILTERS.map((period) => (
                <button
                  className={
                    period === selectedPeriod ? "pill pill-active" : "pill"
                  }
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  type="button"
                >
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>

            <label className="select-wrap">
              <span className="field-label">Method</span>
              <select
                className="method-select"
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (isMethodFilter(nextValue)) {
                    setSelectedMethod(nextValue);
                  }
                }}
                value={selectedMethod}
              >
                <option value="all">{METHOD_LABELS.all}</option>
                {methodOptions.map((method) => (
                  <option key={method} value={method}>
                    {METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Chart series={dailySeries} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Snapshot</p>
              <h2>Current selection</h2>
            </div>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Successful</span>
              <strong>{successCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Errors</span>
              <strong>{errorCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Events</span>
              <strong>{filteredTelemetry.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Error codes</span>
              <strong>{errorSummary.length}</strong>
            </div>
          </div>

          {dashboard ? (
            <div className="ingestion-meta">
              <p>
                <span>Wraps fetched</span>
                <strong>{dashboard.fetchedWrapCount}</strong>
              </p>
              <p>
                <span>Ignored wraps</span>
                <strong>{dashboard.ignoredWrapCount}</strong>
              </p>
              <p>
                <span>Relays used</span>
                <strong>{dashboard.relayUrls.length}</strong>
              </p>
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
              <p className="eyebrow">Error summary</p>
              <h2>Reported error codes</h2>
            </div>
            <p className="panel-meta">
              Sorted by descending count for the selected period and method.
            </p>
          </div>
          <ErrorSummary items={errorSummary} />
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Relays</p>
              <h2>Collector relay set</h2>
            </div>
          </div>

          {dashboard && dashboard.relayUrls.length > 0 ? (
            <div className="relay-list">
              {dashboard.relayUrls.map((relayUrl) => (
                <code className="relay-chip" key={relayUrl}>
                  {relayUrl}
                </code>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <h3>Waiting for login</h3>
              <p>
                Relay discovery runs after the collector account is derived.
              </p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
