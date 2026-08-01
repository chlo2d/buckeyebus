import polyline from "@mapbox/polyline";
import type { RouteDetail, RouteSummary, Stop, Vehicle } from "../api/types";
import {
  haversineMeters,
  minutesRiding,
  minutesWalking,
  projectOntoPolyline,
  type LatLng,
} from "./geo";

export const TRANSFER_WALK_M = 150;
export const ACCESS_WALK_M = 400;
export const SNAP_STOP_M = 250;
export const DEFAULT_WAIT_MIN = 5;
export const TRANSFER_PENALTY_MIN = 2;
export const MAX_TRANSFERS = 2;

export interface StopNode {
  id: string;
  name: string;
  lat: number;
  lng: number;
  routeCodes: string[];
}

export type EdgeKind = "ride" | "walk" | "transfer";

export interface GraphEdge {
  to: string;
  kind: EdgeKind;
  minutes: number;
  routeCode?: string;
  patternId?: string;
  fromStopId?: string;
  toStopId?: string;
  distanceMeters: number;
  /** Along-track distances on pattern polyline for drawing ride segments */
  fromAlong?: number;
  toAlong?: number;
  circular?: boolean;
  patternLength?: number;
}

export interface TransitGraph {
  stops: Map<string, StopNode>;
  edges: Map<string, GraphEdge[]>;
  patterns: Map<
    string,
    {
      routeCode: string;
      patternId: string;
      points: LatLng[];
      lengthMeters: number;
      circular: boolean;
    }
  >;
}

function decodePattern(encoded: string): LatLng[] {
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }));
}

export function buildTransitGraph(
  routes: RouteSummary[],
  details: Record<string, RouteDetail>,
): TransitGraph {
  const stops = new Map<string, StopNode>();
  const edges = new Map<string, GraphEdge[]>();
  const patterns = new Map<
    string,
    {
      routeCode: string;
      patternId: string;
      points: LatLng[];
      lengthMeters: number;
      circular: boolean;
    }
  >();

  const addEdge = (from: string, edge: GraphEdge) => {
    const list = edges.get(from) ?? [];
    list.push(edge);
    edges.set(from, list);
  };

  for (const route of routes) {
    const detail = details[route.code];
    if (!detail) continue;

    for (const stop of detail.stops) {
      const existing = stops.get(stop.id);
      if (existing) {
        if (!existing.routeCodes.includes(route.code)) {
          existing.routeCodes.push(route.code);
        }
      } else {
        stops.set(stop.id, {
          id: stop.id,
          name: stop.name.trim(),
          lat: stop.latitude,
          lng: stop.longitude,
          routeCodes: [route.code],
        });
      }
    }

    for (const pattern of detail.patterns) {
      if (!pattern.encodedPolyline) continue;
      const points = decodePattern(pattern.encodedPolyline);
      if (points.length < 2) continue;

      const circular =
        pattern.direction.toLowerCase() === "circular" ||
        pattern.id === route.code;

      let lengthMeters = 0;
      for (let i = 1; i < points.length; i++) {
        lengthMeters += haversineMeters(points[i - 1], points[i]);
      }

      const patternKey = `${route.code}:${pattern.id}`;
      patterns.set(patternKey, {
        routeCode: route.code,
        patternId: pattern.id,
        points,
        lengthMeters,
        circular,
      });

      const ordered = orderStopsOnPattern(detail.stops, points);
      if (ordered.length < 2) continue;

      const count = ordered.length;
      const limit = circular ? count : count - 1;

      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < (circular ? count + i : count); j++) {
          const fromIdx = i % count;
          const toIdx = j % count;
          if (circular && fromIdx === toIdx) continue;

          const from = ordered[fromIdx];
          const to = ordered[toIdx];
          if (from.stop.id === to.stop.id) continue;

          let rideMeters: number;
          if (!circular) {
            rideMeters = to.along - from.along;
          } else if (to.along >= from.along) {
            rideMeters = to.along - from.along;
          } else {
            rideMeters = lengthMeters - from.along + to.along;
          }

          if (rideMeters < 30) continue;

          addEdge(from.stop.id, {
            to: to.stop.id,
            kind: "ride",
            minutes: minutesRiding(rideMeters),
            routeCode: route.code,
            patternId: pattern.id,
            fromStopId: from.stop.id,
            toStopId: to.stop.id,
            distanceMeters: rideMeters,
            fromAlong: from.along,
            toAlong: to.along,
            circular,
            patternLength: lengthMeters,
          });
        }
      }
    }
  }

  const stopList = [...stops.values()];
  for (let i = 0; i < stopList.length; i++) {
    for (let j = i + 1; j < stopList.length; j++) {
      const a = stopList[i];
      const b = stopList[j];
      const d = haversineMeters(
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
      );
      if (d > TRANSFER_WALK_M) continue;
      const minutes = minutesWalking(d);
      addEdge(a.id, {
        to: b.id,
        kind: "transfer",
        minutes,
        distanceMeters: d,
      });
      addEdge(b.id, {
        to: a.id,
        kind: "transfer",
        minutes,
        distanceMeters: d,
      });
    }
  }

  return { stops, edges, patterns };
}

function orderStopsOnPattern(
  stops: Stop[],
  points: LatLng[],
): { stop: Stop; along: number; dist: number }[] {
  const projected = stops
    .map((stop) => {
      const proj = projectOntoPolyline(
        { lat: stop.latitude, lng: stop.longitude },
        points,
      );
      if (!proj || proj.distanceToLine > 350) return null;
      return { stop, along: proj.distanceAlong, dist: proj.distanceToLine };
    })
    .filter((x): x is { stop: Stop; along: number; dist: number } => x !== null);

  projected.sort((a, b) => a.along - b.along);

  // Drop near-duplicates on the same pattern (same stop id already unique)
  const deduped: typeof projected = [];
  for (const item of projected) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.along - item.along) < 40) {
      if (item.dist < prev.dist) deduped[deduped.length - 1] = item;
      continue;
    }
    deduped.push(item);
  }
  return deduped;
}

export function listUniqueStops(graph: TransitGraph): StopNode[] {
  return [...graph.stops.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function nearestStops(
  graph: TransitGraph,
  point: LatLng,
  maxMeters: number,
  limit = 8,
): { stop: StopNode; meters: number }[] {
  return [...graph.stops.values()]
    .map((stop) => ({
      stop,
      meters: haversineMeters(point, { lat: stop.lat, lng: stop.lng }),
    }))
    .filter((x) => x.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

export function estimateBoardingWaitMinutes(
  routeCode: string,
  boardingStop: StopNode,
  vehicles: Vehicle[],
): number {
  const relevant = vehicles.filter((v) => v.routeCode === routeCode);
  if (relevant.length === 0) return DEFAULT_WAIT_MIN;

  let best = Infinity;
  for (const vehicle of relevant) {
    const d = haversineMeters(
      { lat: vehicle.latitude, lng: vehicle.longitude },
      { lat: boardingStop.lat, lng: boardingStop.lng },
    );
    // Rough: assume bus approaches at ~15 mph average including stops
    const eta = minutesRiding(d, 15);
    if (eta < best) best = eta;
  }

  if (!Number.isFinite(best)) return DEFAULT_WAIT_MIN;
  return Math.max(1, Math.min(12, best));
}
