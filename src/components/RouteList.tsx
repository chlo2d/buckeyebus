import type { RouteSummary } from "../api/types";

interface RouteListProps {
  routes: RouteSummary[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onSelectOnly: (code: string) => void;
}

export function RouteList({
  routes,
  selected,
  onToggle,
  onSelectOnly,
}: RouteListProps) {
  return (
    <section className="routes-section">
      <h2 className="routes-heading">Routes</h2>
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
    </section>
  );
}
