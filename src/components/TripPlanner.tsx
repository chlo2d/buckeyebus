import { useMemo, useState } from "react";
import type { CampusBuilding } from "../api/buildings";
import type { StopNode } from "../routing/graph";
import {
  formatMinutes,
  type Itinerary,
  type TripPoint,
} from "../routing/planner";

export type PlaceSuggestion =
  | { kind: "stop"; stop: StopNode }
  | { kind: "building"; building: CampusBuilding };

interface TripPlannerProps {
  stops: StopNode[];
  buildings: CampusBuilding[];
  origin: TripPoint | null;
  destination: TripPoint | null;
  activeField: "origin" | "destination";
  onActiveFieldChange: (field: "origin" | "destination") => void;
  onPickPlace: (
    field: "origin" | "destination",
    place: PlaceSuggestion,
  ) => void;
  onClearPoint: (field: "origin" | "destination") => void;
  onSwap: () => void;
  itineraries: Itinerary[];
  selectedItineraryId: string | null;
  onSelectItinerary: (id: string) => void;
  planningReady: boolean;
}

export function TripPlanner({
  stops,
  buildings,
  origin,
  destination,
  activeField,
  onActiveFieldChange,
  onPickPlace,
  onClearPoint,
  onSwap,
  itineraries,
  selectedItineraryId,
  onSelectItinerary,
  planningReady,
}: TripPlannerProps) {
  const [originQuery, setOriginQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");

  const originMatches = useMemo(
    () => searchPlaces(stops, buildings, originQuery),
    [stops, buildings, originQuery],
  );
  const destMatches = useMemo(
    () => searchPlaces(stops, buildings, destQuery),
    [stops, buildings, destQuery],
  );

  return (
    <section className="trip-planner">
      <div className="trip-planner-heading">
        <h2>Plan trip</h2>
        <p>Search a stop or building, or click the map</p>
      </div>

      <div className="trip-fields">
        <PlaceField
          label="From"
          active={activeField === "origin"}
          value={origin}
          query={originQuery}
          matches={originMatches}
          onFocus={() => onActiveFieldChange("origin")}
          onQueryChange={setOriginQuery}
          onPick={(place) => {
            onPickPlace("origin", place);
            setOriginQuery("");
          }}
          onClear={() => {
            onClearPoint("origin");
            setOriginQuery("");
          }}
        />

        <button type="button" className="trip-swap" onClick={onSwap}>
          Swap
        </button>

        <PlaceField
          label="To"
          active={activeField === "destination"}
          value={destination}
          query={destQuery}
          matches={destMatches}
          onFocus={() => onActiveFieldChange("destination")}
          onQueryChange={setDestQuery}
          onPick={(place) => {
            onPickPlace("destination", place);
            setDestQuery("");
          }}
          onClear={() => {
            onClearPoint("destination");
            setDestQuery("");
          }}
        />
      </div>

      {!planningReady && (
        <p className="trip-status">Loading campus network…</p>
      )}

      {planningReady && origin && destination && itineraries.length === 0 && (
        <p className="trip-status">No bus path found between those points.</p>
      )}

      {itineraries.length > 0 && (
        <ul className="itinerary-list">
          {itineraries.map((itin, index) => {
            const active = itin.id === selectedItineraryId;
            return (
              <li key={itin.id}>
                <button
                  type="button"
                  className={`itinerary-card${active ? " active" : ""}`}
                  onClick={() => onSelectItinerary(itin.id)}
                >
                  <div className="itinerary-top">
                    <span className="itinerary-rank">
                      {index === 0 ? "Fastest" : `Option ${index + 1}`}
                    </span>
                    <span className="itinerary-time">
                      {formatMinutes(itin.totalMinutes)}
                    </span>
                  </div>
                  <p className="itinerary-summary">{itin.summary}</p>
                  <p className="itinerary-meta">
                    {itin.transfers === 0
                      ? "Direct"
                      : `${itin.transfers} transfer${itin.transfers === 1 ? "" : "s"}`}
                    {itin.waitMinutes >= 1
                      ? ` · ~${Math.round(itin.waitMinutes)} min wait`
                      : ""}
                  </p>
                  {active && (
                    <ol className="itinerary-steps">
                      {itin.legs.map((leg, i) => (
                        <li key={`${leg.kind}-${i}`}>
                          {leg.kind === "ride" ? (
                            <>
                              <span
                                className="step-swatch"
                                style={{
                                  background: leg.routeColor ?? "#ba0c2f",
                                }}
                              />
                              Board <strong>{leg.routeCode}</strong> at{" "}
                              {leg.fromLabel}, ride to {leg.toLabel}
                            </>
                          ) : (
                            <>
                              Walk to {leg.toLabel} (
                              {formatMinutes(leg.minutes)})
                            </>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function searchPlaces(
  stops: StopNode[],
  buildings: CampusBuilding[],
  query: string,
): PlaceSuggestion[] {
  const raw = query.trim().toLowerCase();
  if (raw.length < 2) return [];
  const q = BUILDING_ALIASES[raw] ?? raw;

  type Ranked =
    | { kind: "stop"; stop: StopNode; score: number }
    | { kind: "building"; building: CampusBuilding; score: number };

  const ranked: Ranked[] = [];

  for (const stop of stops) {
    const routeHit = stop.routeCodes.some((code) =>
      code.toLowerCase().includes(raw),
    );
    const score = scoreMatch(q, stop.name.toLowerCase(), null, null, routeHit);
    if (score != null) ranked.push({ kind: "stop", stop, score });
  }

  for (const building of buildings) {
    const score = scoreMatch(
      q,
      building.name.toLowerCase(),
      building.abbreviation?.toLowerCase() ?? null,
      building.code?.toLowerCase() ?? null,
      false,
    );
    if (score != null) ranked.push({ kind: "building", building, score });
  }

  return ranked
    .sort(
      (a, b) =>
        a.score - b.score ||
        (a.kind === "stop" ? a.stop.name : a.building.name).localeCompare(
          b.kind === "stop" ? b.stop.name : b.building.name,
        ),
    )
    .slice(0, 10)
    .map((item) =>
      item.kind === "stop"
        ? { kind: "stop" as const, stop: item.stop }
        : { kind: "building" as const, building: item.building },
    );
}

const BUILDING_ALIASES: Record<string, string> = {
  rpac: "recreation and physical activity center",
  "the rpac": "recreation and physical activity center",
  "ohio union": "ohio union",
  union: "ohio union",
};

/** Lower score is better. */
function scoreMatch(
  query: string,
  name: string,
  abbreviation: string | null,
  code: string | null,
  extraHit: boolean,
): number | null {
  if (abbreviation === query || code === query) return 0;
  if (name === query) return 1;
  if (abbreviation?.startsWith(query) || code?.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  if (abbreviation?.includes(query) || code?.includes(query)) return 5;
  if (extraHit) return 6;
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(query))) return 3.5;
  return null;
}

function PlaceField({
  label,
  active,
  value,
  query,
  matches,
  onFocus,
  onQueryChange,
  onPick,
  onClear,
}: {
  label: string;
  active: boolean;
  value: TripPoint | null;
  query: string;
  matches: PlaceSuggestion[];
  onFocus: () => void;
  onQueryChange: (q: string) => void;
  onPick: (place: PlaceSuggestion) => void;
  onClear: () => void;
}) {
  return (
    <div className={`trip-field${active ? " active" : ""}`}>
      <div className="trip-field-row">
        <label>
          <span className="trip-field-label">{label}</span>
          <input
            type="text"
            value={query}
            placeholder={value?.label ?? "Stop, building, or map click"}
            onFocus={onFocus}
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </label>
        {value && (
          <button type="button" className="trip-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {value && !query && <p className="trip-selected">{value.label}</p>}
      {query && matches.length > 0 && (
        <ul className="stop-suggestions">
          {matches.map((place) =>
            place.kind === "stop" ? (
              <li key={`stop-${place.stop.id}`}>
                <button type="button" onClick={() => onPick(place)}>
                  <span className="suggestion-name">{place.stop.name}</span>
                  <span className="suggestion-routes">
                    Bus stop · {place.stop.routeCodes.join(" · ")}
                  </span>
                </button>
              </li>
            ) : (
              <li key={`building-${place.building.id}`}>
                <button type="button" onClick={() => onPick(place)}>
                  <span className="suggestion-name">{place.building.name}</span>
                  <span className="suggestion-routes">
                    Building
                    {place.building.abbreviation
                      ? ` · ${place.building.abbreviation}`
                      : place.building.code
                        ? ` · ${place.building.code}`
                        : ""}
                    {place.building.address
                      ? ` · ${place.building.address}`
                      : ""}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="trip-status">No matching stops or buildings</p>
      )}
    </div>
  );
}
