"use client";

// Where visits come from, on a map of Vietnam (the realtime panel), like Google Analytics' realtime
// map: one dot per place, bigger with more visits. No map service or library: Vietnam's outline is one
// small built-in shape (from Natural Earth, public domain: world-atlas countries-50m, simplified), and
// each dot sits where the visit's proxy IP is (its IP lookup's coordinates, src/lib/proxy-ip.ts).

import { useState } from "react";

/** Vietnam's outline, in the projection below. */
const VIETNAM = "M39.7 262.2L39.9 265.5L39.1 267.8L39.4 268.8L38.8 269.4L37.5 265.1L35.5 262.6L36.5 262.6L38.2 261.5L39.0 261.4L39.7 262.2ZM114.9 39.8L111.7 40.0L109.7 41.9L104.0 44.3L102.9 48.9L99.3 51.0L97.6 50.0L94.0 51.0L90.0 50.0L91.4 55.3L87.5 59.5L87.9 62.2L86.9 64.2L80.1 70.2L78.1 70.3L76.6 71.2L73.3 78.2L72.9 84.1L71.5 87.4L69.9 88.9L69.7 90.7L74.8 99.9L78.2 103.7L81.5 105.6L86.5 111.1L85.7 112.5L86.1 115.6L83.7 114.7L86.8 116.7L91.0 122.6L98.4 128.9L99.6 132.1L102.9 134.1L106.7 137.2L106.5 137.8L107.5 138.7L110.1 140.3L111.6 142.0L112.2 143.5L115.9 143.4L119.4 148.2L120.5 148.2L120.9 150.2L123.0 152.5L126.5 158.3L131.1 162.4L133.4 170.0L136.2 175.7L136.2 179.0L140.4 192.9L140.1 194.7L139.4 192.9L139.4 198.2L140.1 201.0L139.8 204.4L142.7 210.9L143.2 218.0L141.0 215.0L138.8 217.1L140.5 222.2L138.5 221.7L138.7 228.5L139.6 230.9L139.4 231.8L138.7 229.8L138.4 230.0L137.6 233.3L138.4 235.5L137.1 238.0L135.3 238.2L134.3 243.3L131.1 243.7L128.8 246.0L125.9 246.9L120.6 251.3L117.2 252.0L115.4 255.6L112.4 256.0L101.1 262.0L99.8 260.6L97.8 260.0L96.8 258.9L96.2 256.8L95.1 262.0L94.2 262.3L92.5 261.3L90.9 259.3L88.6 260.7L91.2 261.1L91.9 262.5L91.5 264.1L85.9 264.0L90.9 266.1L92.0 267.0L92.0 267.7L89.6 270.2L89.5 272.0L88.3 272.8L85.5 271.2L79.6 265.6L80.5 267.2L86.7 273.6L87.9 277.2L86.2 278.8L84.2 278.9L80.8 276.5L75.5 270.8L73.7 270.0L80.0 278.1L80.9 280.0L80.1 282.1L67.3 288.1L63.8 294.0L59.9 297.4L55.6 298.3L53.3 298.1L55.7 295.1L54.2 294.0L54.7 277.9L55.8 273.7L59.5 272.0L59.5 271.1L58.2 268.6L55.3 267.7L53.9 265.9L51.2 266.6L50.2 265.8L49.9 264.7L46.7 261.8L49.3 259.7L54.8 259.3L58.6 256.0L58.9 255.3L58.1 252.3L58.6 251.8L63.7 253.1L65.5 251.0L72.2 250.2L74.1 252.7L75.7 252.3L78.8 254.1L80.0 254.1L79.4 251.6L80.0 249.3L74.2 244.1L74.0 237.3L75.5 236.9L77.0 234.8L84.6 236.3L84.9 231.0L90.4 230.4L91.6 229.0L94.8 228.4L100.2 223.9L102.5 223.6L103.7 224.8L105.9 222.7L106.8 219.2L105.2 209.4L107.8 201.3L107.5 199.6L102.5 187.5L103.2 182.6L104.7 181.0L106.4 177.0L106.2 172.6L105.4 170.4L105.6 169.6L106.8 168.9L108.7 164.9L107.0 162.2L101.5 157.6L99.3 154.0L99.8 153.2L103.6 151.0L103.8 149.1L100.3 147.3L97.5 144.4L94.8 142.9L93.3 139.7L92.9 139.5L91.1 140.9L89.5 140.1L87.4 137.0L86.5 130.9L85.1 129.9L82.1 125.7L77.0 121.7L71.0 115.3L69.7 113.3L69.0 110.3L66.5 106.9L64.1 106.2L60.8 103.2L59.3 101.0L60.5 97.0L57.5 95.4L52.2 93.9L40.5 86.1L36.9 84.6L36.4 83.9L36.4 83.2L39.0 81.6L39.7 80.4L38.7 77.1L39.1 76.5L43.4 76.3L49.7 77.6L52.8 74.9L54.7 71.1L56.3 69.6L56.3 68.3L54.8 66.0L51.9 65.9L50.3 62.5L45.5 61.2L48.7 58.9L49.7 57.1L45.2 53.6L40.4 51.1L36.2 52.8L34.4 53.8L33.0 55.7L31.5 56.1L28.1 54.4L21.2 52.2L16.4 44.7L17.1 41.2L18.2 38.6L18.2 36.4L16.2 35.3L15.7 33.9L14.2 36.4L12.7 36.5L11.2 31.9L9.4 30.8L3.5 24.3L2.5 22.4L4.5 20.7L7.8 15.8L9.0 15.0L15.9 18.2L18.0 20.7L18.9 21.0L21.8 19.1L21.9 18.1L25.5 14.6L28.7 18.2L31.2 14.4L36.8 19.3L37.3 19.2L38.3 18.3L39.5 14.9L41.2 14.0L42.5 13.8L44.2 15.7L45.6 15.9L48.5 13.9L51.7 13.6L53.7 11.8L54.4 8.0L55.1 7.3L61.3 4.4L62.9 3.1L66.1 5.3L68.2 8.6L71.0 9.4L73.9 11.5L76.2 11.3L76.9 10.5L79.8 10.6L82.3 12.9L87.3 11.8L91.9 14.4L90.4 17.2L88.1 18.5L87.5 20.0L87.5 23.2L89.1 24.2L89.5 25.2L89.7 30.4L90.9 30.0L94.7 31.6L95.5 31.5L97.3 34.1L99.6 35.7L101.4 35.8L102.9 37.8L104.5 37.2L105.2 38.0L108.4 37.7L110.7 36.9L114.9 39.8ZM88.8 296.4L87.8 296.0L89.6 294.7L89.5 296.0L88.8 296.4ZM99.3 262.0L97.8 263.3L97.6 262.3L99.5 261.1L99.9 261.1L99.3 262.0ZM93.5 53.7L93.3 54.1L91.7 52.7L92.2 51.4L93.5 53.7ZM107.7 45.7L105.0 48.2L103.9 48.1L105.3 44.6L107.7 45.7ZM106.1 51.5L103.8 51.9L106.8 49.3L106.1 51.5ZM96.7 55.0L96.0 55.2L94.4 53.5L95.2 52.7L97.3 53.7L96.7 55.0Z";

/** The projection the outline was made in: equirectangular from 102°E, 23.5°N, 20 units a degree, x by cos(16°). */
const LON0 = 102;
const LAT1 = 23.5;
const K = Math.cos((16 * Math.PI) / 180);
const S = 20;
const W = 146;
const H = 302;

const project = (lat: number, lon: number) => ({ x: (lon - LON0) * K * S, y: (LAT1 - lat) * S });

export interface MapPlace {
  key: string;
  label: string;
  lat: number;
  lon: number;
  visits: number;
}

/**
 * The map, with a dot per place. Places outside the map (not in Vietnam) aren't drawn. `light`: for
 * white paper (the report): a light grey country and violet dots.
 */
export function VietnamMap({ places, className = "", light = false }: { places: MapPlace[]; className?: string; light?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const most = Math.max(1, ...places.map((p) => p.visits));
  const shown = places
    .map((p) => ({ ...p, ...project(p.lat, p.lon) }))
    .filter((p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H)
    // The biggest under, so small dots on top stay visible (and hoverable).
    .sort((a, b) => b.visits - a.visits);
  const active = shown.find((p) => p.key === hover);
  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-auto" role="img" aria-label={`Map of Vietnam: visits from ${shown.length} place${shown.length === 1 ? "" : "s"}`}>
        {light ? (
          <path d={VIETNAM} fill="#eef2f7" stroke="#94a3b8" strokeWidth={0.6} strokeLinejoin="round" />
        ) : (
          <path d={VIETNAM} className="fill-surface-2 stroke-line-strong" strokeWidth={0.6} strokeLinejoin="round" />
        )}
        {shown.map((p) => {
          const r = 3 + 6 * Math.sqrt(p.visits / most);
          const on = hover === p.key;
          return (
            <g key={p.key} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <circle cx={p.x} cy={p.y} r={r} className={light ? undefined : "fill-accent"} fill={light ? "#7c3aed" : undefined} fillOpacity={on ? 0.5 : light ? 0.22 : 0.28} stroke={light ? "#7c3aed" : undefined} strokeOpacity={0.5} strokeWidth={light ? 0.4 : 0} />
              <circle cx={p.x} cy={p.y} r={1.6} className={light ? undefined : "fill-accent"} fill={light ? "#6d28d9" : undefined} />
              <title>{`${p.label}: ${p.visits} visit${p.visits === 1 ? "" : "s"}`}</title>
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="pointer-events-none absolute top-1 left-full z-10 ml-2 rounded-lg border border-line-strong bg-surface-solid px-2 py-1 text-[11px] whitespace-nowrap shadow-lg">
          <b className="text-ink">{active.label}</b> <span className="font-mono text-muted">{active.visits}</span>
        </div>
      )}
    </div>
  );
}
