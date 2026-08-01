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
  lastStop: string;
  id: string;
  bus_id: string;
  updated: string;
  longitude: number;
}

export interface RoutesResponse {
  routes: RouteSummary[];
}

export interface VehiclesResponse {
  vehicles: Vehicle[];
}
