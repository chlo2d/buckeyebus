import { useCallback, useEffect, useMemo, useState } from "react";
import { BusMap } from "./components/BusMap";
import { RouteList } from "./components/RouteList";
import { TripPlanner } from "./components/TripPlanner";
import { fetchRoute, fetchRoutes, fetchVehicles } from "./api/bus";
import type { RouteDetail, RouteSummary, Vehicle } from "./api/types";
import {
  buildTransitGraph,
  listUniqueStops,
  nearestStops,
  SNAP_STOP_M,
  type TransitGraph,
} from "./routing/graph";
import {
  planTrips,
  tripPointFromMap,
  tripPointFromStop,
  type Itinerary,
  type TripPoint,
} from "./routing/planner";
import type { StopNode } from "./routing/graph";
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

  const [origin, setOrigin] = useState<TripPoint | null>(null);
  const [destination, setDestination] = useState<TripPoint | null>(null);
  const [activeField, setActiveField] = useState<"origin" | "destination">(
    "origin",
  );
  const [selectedItineraryId, setSelectedItineraryId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await fetchRoutes();
        if (cancelled) return;

        const list = data.routes;
        setRoutes(list);
        setSelected(
          new Set(
            list
              .filter((route) => route.showByDefault)
              .map((route) => route.code),
          ),
        );

        const detailEntries = await Promise.all(
          list.map(async (route) => {
            const detail = await fetchRoute(route.code);
            return [route.code, detail] as const;
          }),
        );
        if (cancelled) return;

        setDetails(Object.fromEntries(detailEntries));
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
    const codes =
      origin && destination ? routes.map((r) => r.code) : [...selected];
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
  }, [selected, origin, destination, routes]);

  const graph: TransitGraph | null = useMemo(() => {
    if (routes.length === 0) return null;
    const ready = routes.every((r) => details[r.code]);
    if (!ready) return null;
    return buildTransitGraph(routes, details);
  }, [routes, details]);

  const stops = useMemo(
    () => (graph ? listUniqueStops(graph) : []),
    [graph],
  );

  const itineraries: Itinerary[] = useMemo(() => {
    if (!graph || !origin || !destination) return [];
    return planTrips(graph, routes, origin, destination, vehicles);
  }, [graph, routes, origin, destination, vehicles]);

  useEffect(() => {
    if (itineraries.length === 0) {
      setSelectedItineraryId(null);
      return;
    }
    setSelectedItineraryId((prev) =>
      prev && itineraries.some((i) => i.id === prev)
        ? prev
        : itineraries[0].id,
    );
  }, [itineraries]);

  const selectedItinerary =
    itineraries.find((i) => i.id === selectedItineraryId) ?? null;

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

  const assignPoint = useCallback(
    (field: "origin" | "destination", point: TripPoint) => {
      if (field === "origin") setOrigin(point);
      else setDestination(point);
      if (field === "origin" && !destination) setActiveField("destination");
      if (field === "destination" && !origin) setActiveField("origin");
    },
    [origin, destination],
  );

  const onPickStop = useCallback(
    (field: "origin" | "destination", stop: StopNode) => {
      assignPoint(field, tripPointFromStop(stop));
    },
    [assignPoint],
  );

  const onClearPoint = useCallback((field: "origin" | "destination") => {
    if (field === "origin") setOrigin(null);
    else setDestination(null);
    setActiveField(field);
  }, []);

  const onSwap = useCallback(() => {
    setOrigin(destination);
    setDestination(origin);
  }, [origin, destination]);

  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!graph) {
        assignPoint(activeField, tripPointFromMap(lat, lng));
        return;
      }
      const near = nearestStops(graph, { lat, lng }, SNAP_STOP_M, 1)[0];
      if (near) {
        assignPoint(activeField, tripPointFromStop(near.stop));
      } else {
        assignPoint(activeField, tripPointFromMap(lat, lng));
      }
    },
    [graph, activeField, assignPoint],
  );

  return (
    <div className="app">
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

        <TripPlanner
          stops={stops}
          origin={origin}
          destination={destination}
          activeField={activeField}
          onActiveFieldChange={setActiveField}
          onPickStop={onPickStop}
          onClearPoint={onClearPoint}
          onSwap={onSwap}
          itineraries={itineraries}
          selectedItineraryId={selectedItineraryId}
          onSelectItinerary={setSelectedItineraryId}
          planningReady={graph !== null}
        />

        <RouteList
          routes={routes}
          selected={selected}
          onToggle={onToggle}
          onSelectOnly={onSelectOnly}
        />
      </aside>

      <main className="map-pane">
        <div className="map-click-hint">
          Click map to set{" "}
          <strong>{activeField === "origin" ? "From" : "To"}</strong>
        </div>
        <BusMap
          routes={routes}
          details={details}
          vehicles={vehicles}
          selected={selected}
          origin={origin}
          destination={destination}
          itinerary={selectedItinerary}
          onMapClick={onMapClick}
        />
      </main>
    </div>
  );
}

export default App;
