export interface ApiResponse<T> {
  status: string;
  lastModified: string;
  data: T;
}

export interface RouteSummary {
  code: string;
  service: string;
  name: string;
  color: string;
  darkColor: string;
  showByDefault: boolean;
}

export interface RoutePattern {
  length: number;
  id: string;
  encodedPolyline: string;
  direction: string;
}

export interface Stop {
  name: string;
  id: string;
  service: string;
  latitude: number;
  longitude: number;
}

export interface RouteDetail {
  patterns: RoutePattern[];
  stops: Stop[];
}

export interface VehiclePrediction {
  routeCode: string;
  routeColor: string;
  darkColor: string;
  predictionCountdown: string;
  predictionTime: string;
  timeToArrivalInSeconds: number;
  destination: string;
  stopId: string;
  stopName: string;
  type: string;
  systemTime: string;
  vehicleId: string;
  vehicleDistanceInFeet: number;
  isDelayed: boolean;
}

export interface Vehicle {
  routeCode: string;
  distance: number;
  heading: number;
  latitude: number;
  patternId: string;
  destination: string;
  delayed: boolean;
  speed: number;
  service: string;
  lastStop: string | null;
  id: string;
  bus_id: string | null;
  updated: string;
  longitude: number;
  /** Official next-stop ETAs from the live vehicle feed */
  predictions?: VehiclePrediction[];
}

export interface RoutesResponse {
  routes: RouteSummary[];
}

export interface VehiclesResponse {
  vehicles: Vehicle[];
}
