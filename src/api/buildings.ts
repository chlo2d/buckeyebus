import type { ApiResponse } from "./types";

export interface Building {
  recordID: string;
  buildingNumber: string;
  name: string;
  buildingCode: string | null;
  address: string | null;
  city: string | null;
  campus: string | null;
  longitude: string | number | null;
  latitude: string | number | null;
  buildingAbbreviation: string | null;
}

export interface BuildingsResponse {
  buildings: Building[];
}

export type CampusBuilding = {
  id: string;
  name: string;
  abbreviation: string | null;
  code: string | null;
  address: string | null;
  lat: number;
  lng: number;
};

const BUILDINGS_URL = "https://content.osu.edu/v2/api/buildings";

function parseCoord(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeBuilding(building: Building): CampusBuilding | null {
  const lat = parseCoord(building.latitude);
  const lng = parseCoord(building.longitude);
  if (lat == null || lng == null) return null;
  if (!building.name?.trim()) return null;

  return {
    id: building.recordID || building.buildingNumber,
    name: building.name.trim(),
    abbreviation: building.buildingAbbreviation?.trim() || null,
    code: building.buildingCode?.trim() || null,
    address: building.address?.trim() || null,
    lat,
    lng,
  };
}

export async function fetchCampusBuildings(): Promise<CampusBuilding[]> {
  const response = await fetch(BUILDINGS_URL);
  if (!response.ok) {
    throw new Error(`OSU buildings API error ${response.status}`);
  }
  const body = (await response.json()) as ApiResponse<BuildingsResponse>;
  if (body.status !== "success") {
    throw new Error(`OSU buildings API returned status "${body.status}"`);
  }

  return body.data.buildings
    .filter((b) => (b.campus ?? "").toLowerCase() === "columbus")
    .map(normalizeBuilding)
    .filter((b): b is CampusBuilding => b !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
