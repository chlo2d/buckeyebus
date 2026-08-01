import type { RouteSummary } from "../api/types";

interface RouteListProps {
  routes: RouteSummary[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onSelectOnly: (code: string) => void;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export function RouteList({
  routes,
  selected,
  onToggle,
  onSelectOnly,
  loading,
  error,
  lastUpdated,
}: RouteListProps) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <p className="brand">BuckeyeBus</p>
        <p className="tagline">Live campus transit</p>
      </header>

      <div className="sidebar-status">
        {loading && <span>Loading routes…</span>}
        {error && <span className="error">{error}</span>}
        {!loading && !error && lastUpdated && (
          <span>
            Updated{" "}
            {lastUpdated.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      <ul className="route-list">
        {routes.map((route) => {
          const active = selected.has(route.code);
          return (
            <li key={route.code}>
              <button
                type="button"
                className={`route-item${active ? " active" : ""}`}
                onClick={() => onToggle(route.code)}
                onDoubleClick={() => onSelectOnly(route.code)}
                aria-pressed={active}
              >
                <span
                  className="route-swatch"
                  style={{ background: route.color }}
                  aria-hidden
                />
                <span className="route-meta">
                  <span className="route-code">{route.code}</span>
                  <span className="route-name">{route.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="hint">Click to toggle · double-click for only that route</p>
    </aside>
  );
}
