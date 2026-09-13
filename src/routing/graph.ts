import polyline from "@mapbox/polyline";
import type {
  RouteDetail,
  RouteSummary,
  Stop,
  Vehicle,
  VehiclePrediction,
} from "../api/types";
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
/** Wait used when a route has no active vehicles but the live feed is up */
export const NO_SERVICE_WAIT_MIN = 60;
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

export interface BoardingWaitEstimate {
  minutes: number;
  /** True when wait came from official vehicle stop predictions */
  live: boolean;
  /** True when the route has no vehicles in the live feed */
  noService?: boolean;
  vehicleId?: string;
}

export interface LiveRideSegmentEstimate {
  waitMinutes: number;
  rideMinutes: number;
  live: boolean;
  noService: boolean;
  vehicleId?: string;
  /** Minutes from now until the bus reaches the alighting stop */
  arrivalMinutes?: number;
}

/**
 * Estimate wait at a boarding stop for `routeCode`.
 * Prefers live vehicle predictions for that stop; falls back to along-route
 * distance using the vehicle's pattern, then straight-line ETA.
 *
 * `arriveAtStopMinutes` is how many minutes from now the rider reaches the
 * stop (0 for immediate boarding) so transfer waits pick the next bus after
 * the rider arrives.
 *
 * When the live feed has vehicles but none on this route, returns a large
 * no-service wait so inactive routes are not preferred over running buses.
 */
export function estimateBoardingWait(
  routeCode: string,
  boardingStop: StopNode,
  vehicles: Vehicle[],
  graph?: TransitGraph,
  arriveAtStopMinutes = 0,
): BoardingWaitEstimate {
  const relevant = vehicles.filter((v) => v.routeCode === routeCode);
  if (relevant.length === 0) {
    if (vehicles.length > 0) {
      return { minutes: NO_SERVICE_WAIT_MIN, live: false, noService: true };
    }
    return { minutes: DEFAULT_WAIT_MIN, live: false };
  }

  const liveWait = waitFromPredictions(
    boardingStop.id,
    relevant,
    arriveAtStopMinutes,
  );
  if (liveWait) return liveWait;

  const geometric = waitFromGeometry(
    boardingStop,
    relevant,
    graph,
    arriveAtStopMinutes,
  );
  if (geometric) return geometric;

  return { minutes: DEFAULT_WAIT_MIN, live: false };
}

/**
 * Pick the active bus that gets the rider from `fromStopId` to `toStopId`
 * soonest (destination arrival), not merely the first bus at the boarding
 * stop. On loop routes the soonest boarding bus can be the long way around.
 */
export function estimateLiveRideSegment(
  routeCode: string,
  fromStopId: string,
  toStopId: string,
  vehicles: Vehicle[],
  arriveAtStopMinutes: number,
  fallbackRideMinutes: number,
  graph?: TransitGraph,
  boardingStop?: StopNode,
): LiveRideSegmentEstimate {
  const relevant = vehicles.filter((v) => v.routeCode === routeCode);
  if (relevant.length === 0) {
    if (vehicles.length > 0) {
      return {
        waitMinutes: NO_SERVICE_WAIT_MIN,
        rideMinutes: fallbackRideMinutes,
        live: false,
        noService: true,
      };
    }
    return {
      waitMinutes: DEFAULT_WAIT_MIN,
      rideMinutes: fallbackRideMinutes,
      live: false,
      noService: false,
    };
  }

  const nowMs = Date.now();
  let best: LiveRideSegmentEstimate | null = null;

  // 1) Prefer official predictions that include both boarding and alighting.
  for (const vehicle of relevant) {
    const preds = vehicle.predictions;
    if (!preds?.length) continue;

    const fromPred = preds.find((p) => p.stopId === fromStopId);
    const toPred = preds.find((p) => p.stopId === toStopId);
    if (
      !fromPred ||
      !toPred ||
      typeof fromPred.timeToArrivalInSeconds !== "number" ||
      typeof toPred.timeToArrivalInSeconds !== "number"
    ) {
      continue;
    }

    const boardMin = predictionArrivalMinutes(fromPred, nowMs);
    const alightMin = predictionArrivalMinutes(toPred, nowMs);
    // Need boarding at/after the rider arrives, and alighting after boarding
    if (boardMin < arriveAtStopMinutes - 0.75) continue;
    if (alightMin - boardMin < 0.5) continue;

    const waitMinutes = Math.max(0, boardMin - arriveAtStopMinutes);
    const rideMinutes = alightMin - boardMin;
    const arrivalMinutes = Math.max(alightMin, arriveAtStopMinutes + waitMinutes + rideMinutes);

    if (
      !best ||
      arrivalMinutes < (best.arrivalMinutes ?? Infinity) ||
      (arrivalMinutes === best.arrivalMinutes && waitMinutes < best.waitMinutes)
    ) {
      best = {
        waitMinutes,
        rideMinutes,
        live: true,
        noService: false,
        vehicleId: fromPred.vehicleId || vehicle.id,
        arrivalMinutes,
      };
    }
  }

  if (best) return best;

  // 2) Live wait at the boarding stop + directed ride along that bus's pattern.
  // Never pair a geometric "bus is nearby" wait with the short undirected hop —
  // that invented ~1 min waits on loop routes.
  const fromStop =
    boardingStop ??
    (graph?.stops.get(fromStopId) as StopNode | undefined);
  const toStop = graph?.stops.get(toStopId);

  let bestFallback: LiveRideSegmentEstimate | null = null;
  for (const vehicle of relevant) {
    const preds = vehicle.predictions ?? [];
    const fromPred = preds.find((p) => p.stopId === fromStopId);
    if (!fromPred || typeof fromPred.timeToArrivalInSeconds !== "number") {
      continue;
    }
    const boardMin = predictionArrivalMinutes(fromPred, nowMs);
    if (boardMin < arriveAtStopMinutes - 0.75) continue;
    const waitMinutes = Math.max(0, boardMin - arriveAtStopMinutes);

    let rideMinutes = fallbackRideMinutes;
    if (graph && fromStop && toStop) {
      rideMinutes = directedPatternRideMinutes(
        vehicle,
        fromStop,
        toStop,
        graph,
        fallbackRideMinutes,
      );
    }

    const arrivalMinutes = arriveAtStopMinutes + waitMinutes + rideMinutes;
    if (
      !bestFallback ||
      arrivalMinutes < (bestFallback.arrivalMinutes ?? Infinity)
    ) {
      bestFallback = {
        waitMinutes,
        rideMinutes,
        live: true, // wait is live; ride may be pattern-based
        noService: false,
        vehicleId: fromPred.vehicleId || vehicle.id,
        arrivalMinutes,
      };
    }
  }

  if (bestFallback) return bestFallback;

  // 3) Last resort: geometry / defaults (no usable stop predictions).
  const geometric =
    fromStop != null
      ? waitFromGeometry(fromStop, relevant, graph, arriveAtStopMinutes)
      : null;

  return {
    waitMinutes: geometric?.minutes ?? DEFAULT_WAIT_MIN,
    rideMinutes: fallbackRideMinutes,
    live: false,
    noService: false,
    vehicleId: geometric?.vehicleId,
  };
}

/**
 * Live ride duration between two stops from a vehicle's prediction list.
 * Returns null when predictions for both stops are unavailable.
 */
export function estimateRideMinutesFromPredictions(
  vehicles: Vehicle[],
  vehicleId: string | undefined,
  fromStopId: string,
  toStopId: string,
  fallbackMinutes: number,
  graph?: TransitGraph,
): { minutes: number; live: boolean } {
  if (!vehicleId) return { minutes: fallbackMinutes, live: false };

  const vehicle =
    vehicles.find((v) => v.id === vehicleId || v.bus_id === vehicleId) ??
    vehicles.find((v) =>
      v.predictions?.some((p) => p.vehicleId === vehicleId),
    );
  if (!vehicle) {
    return { minutes: fallbackMinutes, live: false };
  }

  const fromPred = vehicle.predictions?.find((p) => p.stopId === fromStopId);
  const toPred = vehicle.predictions?.find((p) => p.stopId === toStopId);
  if (
    fromPred &&
    toPred &&
    typeof fromPred.timeToArrivalInSeconds === "number" &&
    typeof toPred.timeToArrivalInSeconds === "number"
  ) {
    const nowMs = Date.now();
    const boardMin = predictionArrivalMinutes(fromPred, nowMs);
    const alightMin = predictionArrivalMinutes(toPred, nowMs);
    const rideMin = alightMin - boardMin;
    if (rideMin >= 0.5) return { minutes: rideMin, live: true };
  }

  if (graph) {
    const fromStop = graph.stops.get(fromStopId);
    const toStop = graph.stops.get(toStopId);
    if (fromStop && toStop) {
      const directed = directedPatternRideMinutes(
        vehicle,
        fromStop,
        toStop,
        graph,
        fallbackMinutes,
      );
      if (directed !== fallbackMinutes) {
        return { minutes: directed, live: false };
      }
    }
  }

  return { minutes: fallbackMinutes, live: false };
}

/** @deprecated Prefer estimateBoardingWait for live vs estimated metadata */
export function estimateBoardingWaitMinutes(
  routeCode: string,
  boardingStop: StopNode,
  vehicles: Vehicle[],
  arriveAtStopMinutes = 0,
  graph?: TransitGraph,
): number {
  return estimateBoardingWait(
    routeCode,
    boardingStop,
    vehicles,
    graph,
    arriveAtStopMinutes,
  ).minutes;
}

function predictionArrivalMinutes(
  pred: VehiclePrediction,
  nowMs = Date.now(),
): number {
  const rawMin = pred.timeToArrivalInSeconds / 60;
  const systemMs = Date.parse(pred.systemTime);
  if (!Number.isFinite(systemMs)) return rawMin;
  // Predictions are relative to systemTime; subtract age so waits stay accurate
  // between polls.
  const ageMin = Math.max(0, (nowMs - systemMs) / 60_000);
  return rawMin - ageMin;
}

function forwardAlongMeters(
  fromAlong: number,
  toAlong: number,
  lengthMeters: number,
  circular: boolean,
): number {
  if (toAlong >= fromAlong) return toAlong - fromAlong;
  if (circular) return lengthMeters - fromAlong + toAlong;
  return NaN;
}

/**
 * Ride minutes from boarding stop → alighting stop in the vehicle's direction
 * of travel on its pattern (handles loop short-arc vs long-arc).
 */
function directedPatternRideMinutes(
  vehicle: Vehicle,
  fromStop: StopNode,
  toStop: StopNode,
  graph: TransitGraph,
  fallbackMinutes: number,
): number {
  if (!vehicle.patternId) return fallbackMinutes;
  const pattern = graph.patterns.get(
    `${vehicle.routeCode}:${vehicle.patternId}`,
  );
  if (!pattern || pattern.points.length < 2) return fallbackMinutes;

  const busProj = projectOntoPolyline(
    { lat: vehicle.latitude, lng: vehicle.longitude },
    pattern.points,
  );
  const fromProj = projectOntoPolyline(
    { lat: fromStop.lat, lng: fromStop.lng },
    pattern.points,
  );
  const toProj = projectOntoPolyline(
    { lat: toStop.lat, lng: toStop.lng },
    pattern.points,
  );
  if (
    !busProj ||
    !fromProj ||
    !toProj ||
    busProj.distanceToLine > 450 ||
    fromProj.distanceToLine > 350 ||
    toProj.distanceToLine > 350
  ) {
    return fallbackMinutes;
  }

  const busToFrom = forwardAlongMeters(
    busProj.distanceAlong,
    fromProj.distanceAlong,
    pattern.lengthMeters,
    pattern.circular,
  );
  const fromToTo = forwardAlongMeters(
    fromProj.distanceAlong,
    toProj.distanceAlong,
    pattern.lengthMeters,
    pattern.circular,
  );
  if (!Number.isFinite(busToFrom) || !Number.isFinite(fromToTo)) {
    return fallbackMinutes;
  }
  if (fromToTo < 30) return fallbackMinutes;
  return minutesRiding(fromToTo, 14);
}

function waitFromPredictions(
  stopId: string,
  vehicles: Vehicle[],
  arriveAtStopMinutes: number,
  nowMs = Date.now(),
): BoardingWaitEstimate | null {
  let best: BoardingWaitEstimate | null = null;

  for (const vehicle of vehicles) {
    const preds = vehicle.predictions;
    if (!preds?.length) continue;

    for (const pred of preds) {
      if (pred.stopId !== stopId) continue;
      if (typeof pred.timeToArrivalInSeconds !== "number") continue;

      const arrivalMin = predictionArrivalMinutes(pred, nowMs);
      // Bus that arrives before the rider gets to the stop is not usable
      const wait = arrivalMin - arriveAtStopMinutes;
      if (wait < -0.75) continue;

      const minutes = Math.max(0, wait);
      if (!best || minutes < best.minutes) {
        best = {
          minutes,
          live: true,
          vehicleId: pred.vehicleId || vehicle.id,
        };
      }
    }
  }

  return best;
}

function waitFromGeometry(
  boardingStop: StopNode,
  vehicles: Vehicle[],
  graph: TransitGraph | undefined,
  arriveAtStopMinutes: number,
): BoardingWaitEstimate | null {
  let best = Infinity;

  for (const vehicle of vehicles) {
    let etaMinutes: number | null = null;

    if (graph && vehicle.patternId) {
      const patternKey = `${vehicle.routeCode}:${vehicle.patternId}`;
      const pattern = graph.patterns.get(patternKey);
      if (pattern && pattern.points.length >= 2) {
        const busProj = projectOntoPolyline(
          { lat: vehicle.latitude, lng: vehicle.longitude },
          pattern.points,
        );
        const stopProj = projectOntoPolyline(
          { lat: boardingStop.lat, lng: boardingStop.lng },
          pattern.points,
        );
        if (
          busProj &&
          stopProj &&
          busProj.distanceToLine < 400 &&
          stopProj.distanceToLine < 350
        ) {
          let along = stopProj.distanceAlong - busProj.distanceAlong;
          if (along < 0) {
            along = pattern.circular
              ? pattern.lengthMeters + along
              : NaN;
          }
          if (Number.isFinite(along) && along >= 0) {
            // Campus average with dwell; slightly slower than in-motion ride speed
            etaMinutes = minutesRiding(along, 14);
          }
        }
      }
    }

    if (etaMinutes == null) {
      const d = haversineMeters(
        { lat: vehicle.latitude, lng: vehicle.longitude },
        { lat: boardingStop.lat, lng: boardingStop.lng },
      );
      etaMinutes = minutesRiding(d, 15);
    }

    const wait = etaMinutes - arriveAtStopMinutes;
    if (wait < -0.75) continue;
    best = Math.min(best, Math.max(0, wait));
  }

  if (!Number.isFinite(best)) return null;
  return {
    minutes: Math.max(0.5, Math.min(18, best)),
    live: false,
  };
}
