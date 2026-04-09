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
  buildMethodOptions,
  buildMintOptions,
  buildMintSummary,
  filterTelemetryEvents,
  isMethodFilter,
  PERIOD_FILTERS,
  type DailySeriesItem,
  type ErrorSummaryItem,
  type MethodFilter,
  type MintSummaryItem,
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
const ALL_MINTS_VALUE = "";

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

const formatMintLabel = (mint: string | null): string => {
  if (!mint) return "Unknown mint";

  try {
    const url = new URL(mint);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return mint;
  }
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

const Chart = ({ series }: { series: readonly DailySeriesItem[] }) => {
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

        return (
          <g key={item.dayKey}>
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

const MintSummary = ({ items }: { items: readonly MintSummaryItem[] }) => {
  if (items.length === 0) {
    return (
      <div className="empty-panel">
        <h3>No mint data in the selected range</h3>
        <p>The currently visible telemetry does not contain any mint values.</p>
      </div>
    );
  }

  return (
    <div className="mint-list">
      {items.map((item) => (
        <div className="mint-row" key={item.mint ?? "__unknown__"}>
          <div className="mint-copy">
            <p className="mint-label">{formatMintLabel(item.mint)}</p>
            <p className="mint-value">{item.mint ?? "Missing mint value"}</p>
          </div>
          <span className="mint-count">{item.count}</span>
        </div>
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
  const [hydratedFromCache, setHydratedFromCache] = useState(false);

  const deferredMethod = useDeferredValue(selectedMethod);
  const deferredMint = useDeferredValue(selectedMint);
  const telemetry = dashboard?.telemetryEvents ?? [];
  const methodOptions = buildMethodOptions(telemetry);
  const mintOptions = buildMintOptions(telemetry);
  const filteredTelemetry = filterTelemetryEvents({
    mint: deferredMint || null,
    method: deferredMethod,
    period: selectedPeriod,
    telemetry,
  });
  const dailySeries = buildDailySeries({
    period: selectedPeriod,
    telemetry: filteredTelemetry,
  });
  const errorSummary = buildErrorSummary(filteredTelemetry);
  const mintSummary = buildMintSummary(filteredTelemetry);
  const successCount = filteredTelemetry.filter(
    (item) => item.status === "ok",
  ).length;
  const errorCount = filteredTelemetry.filter(
    (item) => item.status === "error",
  ).length;

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
        <div className="hero-layout">
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
                  onClick={() => setSelectedPeriod(period)}
                  type="button"
                >
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>

            <div className="select-group">
              <label className="select-wrap">
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

              <label className="select-wrap">
                <select
                  className="method-select"
                  onChange={(event) => setSelectedMint(event.target.value)}
                  value={selectedMint}
                >
                  <option value={ALL_MINTS_VALUE}>All mints</option>
                  {mintOptions.map((mint) => (
                    <option key={mint} value={mint}>
                      {formatMintLabel(mint)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="chart-shell">
            <Chart series={dailySeries} />
            <div className="chart-bottom-row">
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

              {identity && dashboard ? (
                <div className="chart-footer-meta">
                  <p className="chart-sync-meta">
                    {hydratedFromCache ? "Cached sync" : "Last sync"}{" "}
                    {formatTimestamp(dashboard.lastFetchedAtMs)}
                  </p>
                  <button
                    className="chart-refresh-button"
                    disabled={loadPhase === "loading"}
                    onClick={() => {
                      setHydratedFromCache(false);
                      void refreshTelemetry();
                    }}
                    type="button"
                  >
                    {loadPhase === "loading" ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Snapshot</p>
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
          </div>

          {dashboard ? (
            <div className="snapshot-meta">
              <div className="snapshot-meta-row">
                <span>Events</span>
                <strong>{filteredTelemetry.length}</strong>
              </div>
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

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Mints</p>
            </div>
          </div>
          <MintSummary items={mintSummary} />
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
    </main>
  );
}
