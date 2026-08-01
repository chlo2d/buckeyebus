export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance along a polyline from vertex 0 through vertex `index`, plus optional fraction to next. */
export function distanceAlongPolyline(
  points: LatLng[],
  index: number,
  fraction = 0,
): number {
  if (points.length === 0) return 0;
  let total = 0;
  const capped = Math.min(index, points.length - 1);
  for (let i = 1; i <= capped; i++) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  if (fraction > 0 && capped < points.length - 1) {
    total += haversineMeters(points[capped], points[capped + 1]) * fraction;
  }
  return total;
}

export function polylineLengthMeters(points: LatLng[]): number {
  return distanceAlongPolyline(points, points.length - 1);
}

export interface Projection {
  index: number;
  fraction: number;
  distanceAlong: number;
  distanceToLine: number;
  point: LatLng;
}

/** Project a point onto a polyline; returns closest location along the path. */
export function projectOntoPolyline(
  point: LatLng,
  points: LatLng[],
): Projection | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    return {
      index: 0,
      fraction: 0,
      distanceAlong: 0,
      distanceToLine: haversineMeters(point, points[0]),
      point: points[0],
    };
  }

  let best: Projection | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const projected = projectOntoSegment(point, a, b);
    const along =
      distanceAlongPolyline(points, i) +
      haversineMeters(a, b) * projected.fraction;

    if (!best || projected.distance < best.distanceToLine) {
      best = {
        index: i,
        fraction: projected.fraction,
        distanceAlong: along,
        distanceToLine: projected.distance,
        point: projected.point,
      };
    }
  }

  return best;
}

function projectOntoSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): { point: LatLng; fraction: number; distance: number } {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
  }

  const point = { lat: ay + t * dy, lng: ax + t * dx };
  return { point, fraction: t, distance: haversineMeters(p, point) };
}

/** Slice polyline vertices between two along-track distances. */
export function slicePolylineByDistance(
  points: LatLng[],
  fromDist: number,
  toDist: number,
): LatLng[] {
  if (points.length < 2) return [...points];

  const total = polylineLengthMeters(points);
  let start = Math.max(0, Math.min(fromDist, total));
  let end = Math.max(0, Math.min(toDist, total));
  if (end < start) [start, end] = [end, start];

  const result: LatLng[] = [];
  let traveled = 0;

  const pushIfNew = (pt: LatLng) => {
    const last = result[result.length - 1];
    if (!last || last.lat !== pt.lat || last.lng !== pt.lng) result.push(pt);
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = haversineMeters(a, b);
    const next = traveled + seg;

    if (next < start) {
      traveled = next;
      continue;
    }

    if (traveled <= start && start <= next) {
      const f = seg === 0 ? 0 : (start - traveled) / seg;
      pushIfNew({
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
      });
    }

    if (traveled > start && traveled < end) {
      pushIfNew(a);
    }

    if (traveled <= end && end <= next) {
      const f = seg === 0 ? 0 : (end - traveled) / seg;
      pushIfNew({
        lat: a.lat + (b.lat - a.lat) * f,
        lng: a.lng + (b.lng - a.lng) * f,
      });
      break;
    }

    traveled = next;
  }

  if (result.length === 0) pushIfNew(points[0]);
  return result;
}

export function minutesWalking(meters: number, mph = 3): number {
  const metersPerMinute = (mph * 1609.344) / 60;
  return meters / metersPerMinute;
}

export function minutesRiding(meters: number, mph = 18): number {
  const metersPerMinute = (mph * 1609.344) / 60;
  return meters / metersPerMinute;
}
