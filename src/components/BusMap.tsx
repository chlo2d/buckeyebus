import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  CircleMarker,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import polyline from "@mapbox/polyline";
import type { RouteDetail, RouteSummary, Vehicle } from "../api/types";
import type { Itinerary, TripPoint } from "../routing/planner";

const CAMPUS_CENTER: [number, number] = [40.0015, -83.0165];
const DEFAULT_ZOOM = 14;

interface BusMapProps {
  routes: RouteSummary[];
  details: Record<string, RouteDetail>;
  vehicles: Vehicle[];
  selected: Set<string>;
  origin: TripPoint | null;
  destination: TripPoint | null;
  itinerary: Itinerary | null;
  onMapClick: (lat: number, lng: number) => void;
}

function FitBounds({
  details,
  selected,
  itinerary,
  origin,
  destination,
}: {
  details: Record<string, RouteDetail>;
  selected: Set<string>;
  itinerary: Itinerary | null;
  origin: TripPoint | null;
  destination: TripPoint | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

    if (itinerary) {
      for (const leg of itinerary.legs) {
        for (const p of leg.path) points.push([p.lat, p.lng]);
      }
      if (origin) points.push([origin.lat, origin.lng]);
      if (destination) points.push([destination.lat, destination.lng]);
      if (points.length > 0) {
        map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
      }
      return;
    }

    for (const code of selected) {
      const detail = details[code];
      if (!detail) continue;

      for (const pattern of detail.patterns) {
        if (!pattern.encodedPolyline) continue;
        const decoded = polyline.decode(pattern.encodedPolyline);
        for (const [lat, lng] of decoded) {
          points.push([lat, lng]);
        }
      }

      for (const stop of detail.stops) {
        points.push([stop.latitude, stop.longitude]);
      }
    }

    if (points.length === 0) {
      map.setView(CAMPUS_CENTER, DEFAULT_ZOOM);
      return;
    }

    map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
  }, [details, selected, itinerary, origin, destination, map]);

  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Orient a right-facing 🚌 so it points along heading (0° = north). */
function busOrientation(heading: number) {
  const h = ((heading % 360) + 360) % 360;
  // Mirror when westbound so the emoji stays upright instead of upside-down.
  const flip = h > 180;
  const angle = flip ? h - 270 : h - 90;
  return { angle, flip };
}

function busIcon(color: string, heading: number) {
  const { angle, flip } = busOrientation(heading);
  return L.divIcon({
    className: "bus-marker",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="bus-marker-inner" style="--bus-color:${color};--bus-angle:${angle}deg;--bus-flip:${flip ? -1 : 1}"><span class="bus-marker-emoji" aria-hidden="true">🚌</span></div>`,
  });
}

function endpointIcon(kind: "origin" | "destination") {
  return L.divIcon({
    className: "endpoint-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div class="endpoint-marker-inner ${kind}"></div>`,
  });
}

export function BusMap({
  routes,
  details,
  vehicles,
  selected,
  origin,
  destination,
  itinerary,
  onMapClick,
}: BusMapProps) {
  const routeByCode = useMemo(() => {
    const map = new Map<string, RouteSummary>();
    for (const route of routes) map.set(route.code, route);
    return map;
  }, [routes]);

  const displayRoutes = useMemo(() => {
    if (!itinerary) return selected;
    const codes = new Set(
      itinerary.legs
        .filter((l) => l.routeCode)
        .map((l) => l.routeCode!),
    );
    return codes.size > 0 ? codes : selected;
  }, [itinerary, selected]);

  const polylines = useMemo(() => {
    if (itinerary) return [];

    const lines: {
      key: string;
      positions: [number, number][];
      color: string;
    }[] = [];

    for (const code of displayRoutes) {
      const detail = details[code];
      const route = routeByCode.get(code);
      if (!detail || !route) continue;

      for (const pattern of detail.patterns) {
        if (!pattern.encodedPolyline) continue;
        const positions = polyline.decode(pattern.encodedPolyline) as [
          number,
          number,
        ][];
        lines.push({
          key: `${code}-${pattern.id}`,
          positions,
          color: route.color,
        });
      }
    }

    return lines;
  }, [details, routeByCode, displayRoutes, itinerary]);

  const stops = useMemo(() => {
    const seen = new Set<string>();
    const list: {
      key: string;
      name: string;
      lat: number;
      lng: number;
      color: string;
      routeCode: string;
    }[] = [];

    for (const code of displayRoutes) {
      const detail = details[code];
      const route = routeByCode.get(code);
      if (!detail || !route) continue;

      for (const stop of detail.stops) {
        const key = `${code}-${stop.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          key,
          name: stop.name,
          lat: stop.latitude,
          lng: stop.longitude,
          color: route.color,
          routeCode: code,
        });
      }
    }

    return list;
  }, [details, routeByCode, displayRoutes]);

  return (
    <MapContainer
      center={CAMPUS_CENTER}
      zoom={DEFAULT_ZOOM}
      className="bus-map"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <MapClickHandler onMapClick={onMapClick} />
      <FitBounds
        details={details}
        selected={displayRoutes}
        itinerary={itinerary}
        origin={origin}
        destination={destination}
      />

      {polylines.map((line) => (
        <Polyline
          key={line.key}
          positions={line.positions}
          pathOptions={{
            color: line.color,
            weight: 5,
            opacity: itinerary ? 0.25 : 0.85,
            lineJoin: "round",
            lineCap: "round",
          }}
        />
      ))}

      {itinerary?.legs.map((leg, index) => {
        const positions = leg.path.map(
          (p) => [p.lat, p.lng] as [number, number],
        );
        if (leg.kind === "walk") {
          return (
            <Polyline
              key={`walk-${index}`}
              positions={positions}
              pathOptions={{
                color: "#1c1c1c",
                weight: 3,
                opacity: 0.75,
                dashArray: "6 8",
              }}
            />
          );
        }
        return (
          <Polyline
            key={`ride-${index}`}
            positions={positions}
            pathOptions={{
              color: leg.routeColor ?? "#ba0c2f",
              weight: 6,
              opacity: 0.95,
              lineJoin: "round",
              lineCap: "round",
            }}
          />
        );
      })}

      {!itinerary &&
        stops.map((stop) => (
          <CircleMarker
            key={stop.key}
            center={[stop.lat, stop.lng]}
            radius={5}
            pathOptions={{
              color: "#1a1a1a",
              weight: 1,
              fillColor: stop.color,
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <strong>{stop.name}</strong>
              <br />
              Route {stop.routeCode}
            </Popup>
          </CircleMarker>
        ))}

      {itinerary &&
        itinerary.legs.map((leg, index) => (
          <CircleMarker
            key={`leg-stop-${index}`}
            center={[leg.to.lat, leg.to.lng]}
            radius={leg.kind === "ride" ? 7 : 5}
            pathOptions={{
              color: "#1a1a1a",
              weight: 1,
              fillColor: leg.routeColor ?? "#666",
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <strong>{leg.toLabel}</strong>
            </Popup>
          </CircleMarker>
        ))}

      {vehicles.map((vehicle) => {
        const route = routeByCode.get(vehicle.routeCode);
        const color = route?.color ?? "#ba0c2f";
        return (
          <Marker
            key={vehicle.bus_id || vehicle.id}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={busIcon(color, vehicle.heading || 0)}
          >
            <Popup>
              <strong>{vehicle.id}</strong>
              <br />
              Route {vehicle.routeCode}
              {vehicle.destination ? (
                <>
                  <br />
                  To {vehicle.destination}
                </>
              ) : null}
              <br />
              {Math.round(vehicle.speed)} mph
              {vehicle.delayed ? " · delayed" : ""}
            </Popup>
          </Marker>
        );
      })}

      {origin && (
        <Marker
          position={[origin.lat, origin.lng]}
          icon={endpointIcon("origin")}
        >
          <Popup>
            <strong>From</strong>
            <br />
            {origin.label}
          </Popup>
        </Marker>
      )}

      {destination && (
        <Marker
          position={[destination.lat, destination.lng]}
          icon={endpointIcon("destination")}
        >
          <Popup>
            <strong>To</strong>
            <br />
            {destination.label}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
