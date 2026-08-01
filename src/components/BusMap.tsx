import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import polyline from "@mapbox/polyline";
import type { RouteDetail, RouteSummary, Vehicle } from "../api/types";

const CAMPUS_CENTER: [number, number] = [40.0015, -83.0165];
const DEFAULT_ZOOM = 14;

interface BusMapProps {
  routes: RouteSummary[];
  details: Record<string, RouteDetail>;
  vehicles: Vehicle[];
  selected: Set<string>;
}

function FitBounds({
  details,
  selected,
}: {
  details: Record<string, RouteDetail>;
  selected: Set<string>;
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

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
  }, [details, selected, map]);

  return null;
}

function busIcon(color: string, heading: number) {
  return L.divIcon({
    className: "bus-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="bus-marker-inner" style="--bus-color:${color};--bus-heading:${heading}deg"></div>`,
  });
}

export function BusMap({ routes, details, vehicles, selected }: BusMapProps) {
  const routeByCode = useMemo(() => {
    const map = new Map<string, RouteSummary>();
    for (const route of routes) map.set(route.code, route);
    return map;
  }, [routes]);

  const polylines = useMemo(() => {
    const lines: {
      key: string;
      positions: [number, number][];
      color: string;
    }[] = [];

    for (const code of selected) {
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
  }, [details, routeByCode, selected]);

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

    for (const code of selected) {
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
  }, [details, routeByCode, selected]);

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
      <FitBounds details={details} selected={selected} />

      {polylines.map((line) => (
        <Polyline
          key={line.key}
          positions={line.positions}
          pathOptions={{
            color: line.color,
            weight: 5,
            opacity: 0.85,
            lineJoin: "round",
            lineCap: "round",
          }}
        />
      ))}

      {stops.map((stop) => (
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
    </MapContainer>
  );
}
