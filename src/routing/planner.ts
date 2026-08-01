import type { RouteSummary, Vehicle } from "../api/types";
import {
  haversineMeters,
  minutesWalking,
  slicePolylineByDistance,
  type LatLng,
} from "./geo";
import {
  ACCESS_WALK_M,
  estimateBoardingWaitMinutes,
  MAX_TRANSFERS,
  SNAP_STOP_M,
  TRANSFER_PENALTY_MIN,
  type GraphEdge,
  type StopNode,
  type TransitGraph,
} from "./graph";

export type TripPoint =
  | { kind: "stop"; stopId: string; label: string; lat: number; lng: number }
  | { kind: "map"; label: string; lat: number; lng: number };

export type LegKind = "walk" | "ride";

export interface TripLeg {
  kind: LegKind;
  minutes: number;
  distanceMeters: number;
  instruction: string;
  routeCode?: string;
  routeName?: string;
  routeColor?: string;
  fromLabel: string;
  toLabel: string;
  from: LatLng;
  to: LatLng;
  /** Geometry for map drawing */
  path: LatLng[];
}

export interface Itinerary {
  id: string;
  totalMinutes: number;
  walkMinutes: number;
  rideMinutes: number;
  waitMinutes: number;
  transfers: number;
  summary: string;
  legs: TripLeg[];
}

interface SearchNode {
  id: string;
  lat: number;
  lng: number;
  label: string;
  stopId?: string;
}

interface PathState {
  nodeId: string;
  minutes: number;
  transfers: number;
  boardedRoute: string | null;
  via: GraphEdge | null;
  prev: PathState | null;
}

const ORIGIN_ID = "__origin__";
const DEST_ID = "__dest__";

function pointToSearchNode(point: TripPoint, graph: TransitGraph): SearchNode {
  if (point.kind === "stop") {
    const stop = graph.stops.get(point.stopId);
    if (stop) {
      return {
        id: stop.id,
        lat: stop.lat,
        lng: stop.lng,
        label: stop.name,
        stopId: stop.id,
      };
    }
  }
  return {
    id: point.kind === "stop" ? point.stopId : `${point.lat},${point.lng}`,
    lat: point.lat,
    lng: point.lng,
    label: point.label,
    stopId: point.kind === "stop" ? point.stopId : undefined,
  };
}

function snapOrKeep(
  point: TripPoint,
  graph: TransitGraph,
): TripPoint {
  if (point.kind === "stop" && graph.stops.has(point.stopId)) return point;
  const near = [...graph.stops.values()]
    .map((stop) => ({
      stop,
      meters: haversineMeters(
        { lat: point.lat, lng: point.lng },
        { lat: stop.lat, lng: stop.lng },
      ),
    }))
    .sort((a, b) => a.meters - b.meters)[0];

  if (near && near.meters <= SNAP_STOP_M) {
    return {
      kind: "stop",
      stopId: near.stop.id,
      label: near.stop.name,
      lat: near.stop.lat,
      lng: near.stop.lng,
    };
  }
  return point;
}

export function planTrips(
  graph: TransitGraph,
  routes: RouteSummary[],
  originInput: TripPoint,
  destinationInput: TripPoint,
  vehicles: Vehicle[],
): Itinerary[] {
  const origin = snapOrKeep(originInput, graph);
  const destination = snapOrKeep(destinationInput, graph);

  if (
    origin.kind === "stop" &&
    destination.kind === "stop" &&
    origin.stopId === destination.stopId
  ) {
    return [];
  }

  const directWalk = walkOnlyItinerary(origin, destination);
  const busOptions = searchBusItineraries(
    graph,
    routes,
    origin,
    destination,
    vehicles,
  );

  const combined = [...busOptions];
  if (directWalk) {
    const bestBus = busOptions[0];
    if (!bestBus || directWalk.totalMinutes + 0.5 < bestBus.totalMinutes) {
      combined.push(directWalk);
    } else if (directWalk.totalMinutes <= 15) {
      combined.push(directWalk);
    }
  }

  combined.sort(
    (a, b) =>
      a.totalMinutes - b.totalMinutes || a.transfers - b.transfers,
  );

  return dedupeItineraries(combined).slice(0, 3);
}

function walkOnlyItinerary(
  origin: TripPoint,
  destination: TripPoint,
): Itinerary | null {
  const from = { lat: origin.lat, lng: origin.lng };
  const to = { lat: destination.lat, lng: destination.lng };
  const meters = haversineMeters(from, to);
  if (meters < 15) return null;
  const minutes = minutesWalking(meters);
  return {
    id: "walk-only",
    totalMinutes: minutes,
    walkMinutes: minutes,
    rideMinutes: 0,
    waitMinutes: 0,
    transfers: 0,
    summary: `Walk ${formatMinutes(minutes)}`,
    legs: [
      {
        kind: "walk",
        minutes,
        distanceMeters: meters,
        instruction: `Walk to ${destination.label}`,
        fromLabel: origin.label,
        toLabel: destination.label,
        from,
        to,
        path: [from, to],
      },
    ],
  };
}

function searchBusItineraries(
  graph: TransitGraph,
  routes: RouteSummary[],
  origin: TripPoint,
  destination: TripPoint,
  vehicles: Vehicle[],
): Itinerary[] {
  const originNode = pointToSearchNode(origin, graph);
  const destNode = pointToSearchNode(destination, graph);

  const adj = new Map<string, GraphEdge[]>();
  for (const [from, list] of graph.edges) {
    adj.set(from, [...list]);
  }

  // Attach origin/destination access walks
  const originStops = nearbyAccess(graph, originNode);
  const destStops = nearbyAccess(graph, destNode);

  if (originStops.length === 0 || destStops.length === 0) return [];

  adj.set(ORIGIN_ID, []);
  for (const { stop, meters } of originStops) {
    adj.get(ORIGIN_ID)!.push({
      to: stop.id,
      kind: "walk",
      minutes: minutesWalking(meters),
      distanceMeters: meters,
    });
  }

  for (const { stop, meters } of destStops) {
    const list = adj.get(stop.id) ?? [];
    list.push({
      to: DEST_ID,
      kind: "walk",
      minutes: minutesWalking(meters),
      distanceMeters: meters,
    });
    adj.set(stop.id, list);
  }

  if (originNode.stopId) {
    // Allow starting already at a stop without an extra walk leg of 0
    // (access edge already covers it)
  }

  const labels = new Map<string, string>();
  labels.set(ORIGIN_ID, origin.label);
  labels.set(DEST_ID, destination.label);
  for (const stop of graph.stops.values()) {
    labels.set(stop.id, stop.name);
  }

  const coords = new Map<string, LatLng>();
  coords.set(ORIGIN_ID, { lat: origin.lat, lng: origin.lng });
  coords.set(DEST_ID, { lat: destination.lat, lng: destination.lng });
  for (const stop of graph.stops.values()) {
    coords.set(stop.id, { lat: stop.lat, lng: stop.lng });
  }

  const routeByCode = new Map(routes.map((r) => [r.code, r]));

  // Dijkstra with state key: nodeId|transfers|boardedRoute
  type HeapItem = PathState;
  const heap: HeapItem[] = [];
  const best = new Map<string, number>();
  const goals: PathState[] = [];

  const push = (state: PathState) => {
    const key = `${state.nodeId}|${state.transfers}|${state.boardedRoute ?? ""}`;
    const prevBest = best.get(key);
    if (prevBest !== undefined && prevBest <= state.minutes) return;
    best.set(key, state.minutes);
    heap.push(state);
  };

  push({
    nodeId: ORIGIN_ID,
    minutes: 0,
    transfers: 0,
    boardedRoute: null,
    via: null,
    prev: null,
  });

  while (heap.length > 0) {
    heap.sort((a, b) => a.minutes - b.minutes);
    const cur = heap.shift()!;
    const key = `${cur.nodeId}|${cur.transfers}|${cur.boardedRoute ?? ""}`;
    if ((best.get(key) ?? Infinity) < cur.minutes) continue;

    if (cur.nodeId === DEST_ID) {
      goals.push(cur);
      if (goals.length >= 12) break;
      continue;
    }

    const edges = adj.get(cur.nodeId) ?? [];
    for (const edge of edges) {
      let nextTransfers = cur.transfers;
      let nextBoarded = cur.boardedRoute;
      let extra = 0;

      if (edge.kind === "ride") {
        if (cur.boardedRoute && cur.boardedRoute !== edge.routeCode) {
          nextTransfers += 1;
          extra += TRANSFER_PENALTY_MIN;
        }
        if (!cur.boardedRoute || cur.boardedRoute !== edge.routeCode) {
          // Boarding wait when starting a ride or transferring onto a new route
          const boardingStop =
            edge.fromStopId != null
              ? graph.stops.get(edge.fromStopId)
              : graph.stops.get(cur.nodeId);
          if (boardingStop && edge.routeCode) {
            extra += estimateBoardingWaitMinutes(
              edge.routeCode,
              boardingStop,
              vehicles,
            );
          } else {
            extra += 5;
          }
        }
        nextBoarded = edge.routeCode ?? null;
      } else if (edge.kind === "transfer") {
        nextBoarded = null;
        // walking between nearby stops between buses counts toward transfer limit only when coming from a ride
        if (cur.boardedRoute) {
          // soft: don't increment transfers on pure walk transfer edges; ride change does
        }
      } else if (edge.kind === "walk") {
        if (edge.to === DEST_ID) {
          nextBoarded = null;
        }
      }

      if (nextTransfers > MAX_TRANSFERS) continue;

      push({
        nodeId: edge.to,
        minutes: cur.minutes + edge.minutes + extra,
        transfers: nextTransfers,
        boardedRoute: nextBoarded,
        via: edge,
        prev: cur,
      });
    }
  }

  const itineraries: Itinerary[] = [];
  for (const goal of goals) {
    const itin = reconstruct(
      goal,
      graph,
      routeByCode,
      labels,
      coords,
      origin,
      destination,
    );
    if (itin) itineraries.push(itin);
  }

  itineraries.sort(
    (a, b) => a.totalMinutes - b.totalMinutes || a.transfers - b.transfers,
  );
  return dedupeItineraries(itineraries);
}

function nearbyAccess(
  graph: TransitGraph,
  node: SearchNode,
): { stop: StopNode; meters: number }[] {
  if (node.stopId) {
    const stop = graph.stops.get(node.stopId);
    if (stop) return [{ stop, meters: 0 }];
  }
  return [...graph.stops.values()]
    .map((stop) => ({
      stop,
      meters: haversineMeters(
        { lat: node.lat, lng: node.lng },
        { lat: stop.lat, lng: stop.lng },
      ),
    }))
    .filter((x) => x.meters <= ACCESS_WALK_M)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 8);
}

function reconstruct(
  goal: PathState,
  graph: TransitGraph,
  routeByCode: Map<string, RouteSummary>,
  labels: Map<string, string>,
  coords: Map<string, LatLng>,
  origin: TripPoint,
  destination: TripPoint,
): Itinerary | null {
  const chain: { state: PathState; edge: GraphEdge }[] = [];
  let cur: PathState | null = goal;
  while (cur && cur.via && cur.prev) {
    chain.push({ state: cur, edge: cur.via });
    cur = cur.prev;
  }
  chain.reverse();
  if (chain.length === 0) return null;

  const rawLegs: TripLeg[] = [];

  for (const { state, edge } of chain) {
    const fromId = state.prev!.nodeId;
    const toId = state.nodeId;
    const from = coords.get(fromId)!;
    const to = coords.get(toId)!;
    const fromLabel = labels.get(fromId) ?? "Point";
    const toLabel = labels.get(toId) ?? "Point";

    if (edge.kind === "ride" && edge.routeCode && edge.patternId) {
      const patternKey = `${edge.routeCode}:${edge.patternId}`;
      const pattern = graph.patterns.get(patternKey);
      let path: LatLng[] = [from, to];
      if (
        pattern &&
        edge.fromAlong != null &&
        edge.toAlong != null &&
        edge.patternLength != null
      ) {
        if (
          edge.circular &&
          edge.toAlong < edge.fromAlong
        ) {
          const a = slicePolylineByDistance(
            pattern.points,
            edge.fromAlong,
            edge.patternLength,
          );
          const b = slicePolylineByDistance(pattern.points, 0, edge.toAlong);
          path = [...a, ...b];
        } else {
          path = slicePolylineByDistance(
            pattern.points,
            edge.fromAlong,
            edge.toAlong,
          );
        }
      }

      const route = routeByCode.get(edge.routeCode);
      rawLegs.push({
        kind: "ride",
        minutes: edge.minutes,
        distanceMeters: edge.distanceMeters,
        instruction: `Take ${edge.routeCode} to ${toLabel}`,
        routeCode: edge.routeCode,
        routeName: route?.name,
        routeColor: route?.color,
        fromLabel,
        toLabel,
        from,
        to,
        path: path.length >= 2 ? path : [from, to],
      });
    } else {
      const isAccess =
        fromId === ORIGIN_ID ||
        toId === DEST_ID ||
        edge.kind === "walk" ||
        edge.kind === "transfer";
      if (!isAccess) continue;
      // Skip zero-length walks
      if (edge.distanceMeters < 12 && fromId !== ORIGIN_ID && toId !== DEST_ID) {
        continue;
      }
      rawLegs.push({
        kind: "walk",
        minutes: Math.max(edge.minutes, minutesWalking(edge.distanceMeters)),
        distanceMeters: edge.distanceMeters,
        instruction:
          toId === DEST_ID
            ? `Walk to ${destination.label}`
            : fromId === ORIGIN_ID
              ? `Walk to ${toLabel}`
              : `Walk to ${toLabel}`,
        fromLabel: fromId === ORIGIN_ID ? origin.label : fromLabel,
        toLabel: toId === DEST_ID ? destination.label : toLabel,
        from,
        to,
        path: [from, to],
      });
    }
  }

  const legs = mergeConsecutiveRides(
    rawLegs.filter((leg) => !(leg.kind === "walk" && leg.distanceMeters < 20)),
  );
  if (legs.length === 0) return null;

  const walkMinutes = legs
    .filter((l) => l.kind === "walk")
    .reduce((s, l) => s + l.minutes, 0);
  const rideMinutes = legs
    .filter((l) => l.kind === "ride")
    .reduce((s, l) => s + l.minutes, 0);
  const transfers = Math.max(
    0,
    legs.filter((l) => l.kind === "ride").length - 1,
  );
  const waitMinutes = Math.max(0, goal.minutes - walkMinutes - rideMinutes);
  const totalMinutes = goal.minutes;

  const rideCodes = legs
    .filter((l) => l.kind === "ride" && l.routeCode)
    .map((l) => l.routeCode!);
  const summary =
    rideCodes.length > 0
      ? `${rideCodes.join(" → ")} · ${formatMinutes(totalMinutes)}`
      : `Walk ${formatMinutes(totalMinutes)}`;

  const legKey = legs
    .map((l) =>
      l.kind === "ride"
        ? `R:${l.routeCode}:${l.fromLabel}:${l.toLabel}`
        : `W:${l.toLabel}`,
    )
    .join("|");

  return {
    id: `itin-${legKey}`,
    totalMinutes,
    walkMinutes,
    rideMinutes,
    waitMinutes,
    transfers,
    summary,
    legs,
  };
}

function mergeConsecutiveRides(legs: TripLeg[]): TripLeg[] {
  const out: TripLeg[] = [];
  for (const leg of legs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === "ride" &&
      leg.kind === "ride" &&
      prev.routeCode === leg.routeCode
    ) {
      prev.to = leg.to;
      prev.toLabel = leg.toLabel;
      prev.minutes += leg.minutes;
      prev.distanceMeters += leg.distanceMeters;
      prev.path = [...prev.path, ...leg.path.slice(1)];
      prev.instruction = `Take ${prev.routeCode} to ${prev.toLabel}`;
      continue;
    }
    // Drop tiny walk between same-route rides that slipped through
    if (
      prev &&
      prev.kind === "ride" &&
      leg.kind === "walk" &&
      leg.distanceMeters < 80
    ) {
      // peek ahead handled by not pushing yet — keep walk for transfers
    }
    out.push({ ...leg, path: [...leg.path] });
  }
  return out;
}

function dedupeItineraries(items: Itinerary[]): Itinerary[] {
  const seen = new Set<string>();
  const unique: Itinerary[] = [];
  for (const item of items) {
    const key = item.legs
      .map((l) =>
        l.kind === "ride"
          ? `R:${l.routeCode}:${l.fromLabel}:${l.toLabel}`
          : `W:${Math.round(l.distanceMeters / 50)}`,
      )
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  // Drop options that are worse on both time and transfers
  const kept: Itinerary[] = [];
  for (const item of unique) {
    const dominated = unique.some(
      (other) =>
        other !== item &&
        other.totalMinutes <= item.totalMinutes + 0.75 &&
        other.transfers < item.transfers,
    );
    const muchWorse =
      kept[0] && item.totalMinutes > kept[0].totalMinutes * 1.6;
    if (dominated || muchWorse) continue;
    kept.push(item);
  }

  // Prefer variety: keep fastest, then lowest transfers among rest, then next distinct route set
  const result: Itinerary[] = [];
  for (const item of kept) {
    if (result.length === 0) {
      result.push(item);
      continue;
    }
    const routeSet = item.legs
      .filter((l) => l.routeCode)
      .map((l) => l.routeCode)
      .join(",");
    const duplicateRoutes = result.some(
      (r) =>
        r.legs
          .filter((l) => l.routeCode)
          .map((l) => l.routeCode)
          .join(",") === routeSet,
    );
    if (duplicateRoutes) continue;
    result.push(item);
    if (result.length >= 3) break;
  }
  return result;
}

export function formatMinutes(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

export function tripPointFromStop(stop: StopNode): TripPoint {
  return {
    kind: "stop",
    stopId: stop.id,
    label: stop.name,
    lat: stop.lat,
    lng: stop.lng,
  };
}

export function tripPointFromMap(lat: number, lng: number): TripPoint {
  return {
    kind: "map",
    label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    lat,
    lng,
  };
}
