import { useCallback, useEffect, useState } from "react";
import { BusMap } from "./components/BusMap";
import { RouteList } from "./components/RouteList";
import { fetchRoute, fetchRoutes, fetchVehicles } from "./api/bus";
import type { RouteDetail, RouteSummary, Vehicle } from "./api/types";
import "leaflet/dist/leaflet.css";
import "./App.css";

const VEHICLE_POLL_MS = 5000;

function App() {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, RouteDetail>>({});
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await fetchRoutes();
        if (cancelled) return;

        const list = data.routes;
        setRoutes(list);

        const initial = new Set(
          list.filter((route) => route.showByDefault).map((route) => route.code),
        );
        setSelected(initial);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load routes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const missing = [...selected].filter((code) => !details[code]);
    if (missing.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const results = await Promise.all(
          missing.map(async (code) => [code, await fetchRoute(code)] as const),
        );
        if (cancelled) return;

        setDetails((prev) => {
          const next = { ...prev };
          for (const [code, detail] of results) {
            next[code] = detail;
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load route details",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selected, details]);

  useEffect(() => {
    const codes = [...selected];
    if (codes.length === 0) {
      setVehicles([]);
      return;
    }

    let cancelled = false;

    const loadVehicles = async () => {
      try {
        const batches = await Promise.all(
          codes.map((code) => fetchVehicles(code)),
        );
        if (cancelled) return;

        setVehicles(batches.flatMap((batch) => batch.vehicles));
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load vehicles",
          );
        }
      }
    };

    void loadVehicles();
    const timer = window.setInterval(loadVehicles, VEHICLE_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selected]);

  const onToggle = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const onSelectOnly = useCallback((code: string) => {
    setSelected(new Set([code]));
  }, []);

  return (
    <div className="app">
      <RouteList
        routes={routes}
        selected={selected}
        onToggle={onToggle}
        onSelectOnly={onSelectOnly}
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
      />
      <main className="map-pane">
        <BusMap
          routes={routes}
          details={details}
          vehicles={vehicles}
          selected={selected}
        />
      </main>
    </div>
  );
}

export default App;
