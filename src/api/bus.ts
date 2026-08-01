import type {
  ApiResponse,
  RouteDetail,
  RoutesResponse,
  VehiclesResponse,
} from "./types";

const BASE_URL = "https://content.osu.edu/v2/bus";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`OSU bus API error ${response.status} for ${path}`);
  }
  const body = (await response.json()) as ApiResponse<T>;
  if (body.status !== "success") {
    throw new Error(`OSU bus API returned status "${body.status}" for ${path}`);
  }
  return body.data;
}

export function fetchRoutes() {
  return getJson<RoutesResponse>("/routes");
}

export function fetchRoute(code: string) {
  return getJson<RouteDetail>(`/routes/${encodeURIComponent(code)}`);
}

export function fetchVehicles(code: string) {
  return getJson<VehiclesResponse>(
    `/routes/${encodeURIComponent(code)}/vehicles`,
  );
}
