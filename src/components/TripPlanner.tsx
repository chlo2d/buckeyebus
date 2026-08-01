import { useMemo, useState } from "react";
import type { StopNode } from "../routing/graph";
import {
  formatMinutes,
  type Itinerary,
  type TripPoint,
} from "../routing/planner";

interface TripPlannerProps {
  stops: StopNode[];
  origin: TripPoint | null;
  destination: TripPoint | null;
  activeField: "origin" | "destination";
  onActiveFieldChange: (field: "origin" | "destination") => void;
  onPickStop: (field: "origin" | "destination", stop: StopNode) => void;
  onClearPoint: (field: "origin" | "destination") => void;
  onSwap: () => void;
  itineraries: Itinerary[];
  selectedItineraryId: string | null;
  onSelectItinerary: (id: string) => void;
  planningReady: boolean;
}

export function TripPlanner({
  stops,
  origin,
  destination,
  activeField,
  onActiveFieldChange,
  onPickStop,
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
    () => filterStops(stops, originQuery),
    [stops, originQuery],
  );
  const destMatches = useMemo(
    () => filterStops(stops, destQuery),
    [stops, destQuery],
  );

  return (
    <section className="trip-planner">
      <div className="trip-planner-heading">
        <h2>Plan trip</h2>
        <p>Search a stop or click the map</p>
      </div>

      <div className="trip-fields">
        <StopField
          label="From"
          active={activeField === "origin"}
          value={origin}
          query={originQuery}
          matches={originMatches}
          onFocus={() => onActiveFieldChange("origin")}
          onQueryChange={setOriginQuery}
          onPick={(stop) => {
            onPickStop("origin", stop);
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

        <StopField
          label="To"
          active={activeField === "destination"}
          value={destination}
          query={destQuery}
          matches={destMatches}
          onFocus={() => onActiveFieldChange("destination")}
          onQueryChange={setDestQuery}
          onPick={(stop) => {
            onPickStop("destination", stop);
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

function filterStops(stops: StopNode[], query: string): StopNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return stops
    .filter(
      (stop) =>
        stop.name.toLowerCase().includes(q) ||
        stop.routeCodes.some((code) => code.toLowerCase().includes(q)),
    )
    .slice(0, 8);
}

function StopField({
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
  matches: StopNode[];
  onFocus: () => void;
  onQueryChange: (q: string) => void;
  onPick: (stop: StopNode) => void;
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
            placeholder={value?.label ?? "Stop or map click"}
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
      {value && !query && (
        <p className="trip-selected">{value.label}</p>
      )}
      {query && matches.length > 0 && (
        <ul className="stop-suggestions">
          {matches.map((stop) => (
            <li key={stop.id}>
              <button type="button" onClick={() => onPick(stop)}>
                <span className="suggestion-name">{stop.name}</span>
                <span className="suggestion-routes">
                  {stop.routeCodes.join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
