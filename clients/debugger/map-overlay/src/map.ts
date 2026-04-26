import maplibregl from "maplibre-gl";
import { cellToLatLng } from "h3-js";
import "maplibre-gl/dist/maplibre-gl.css";

/** MapLibre uses [lng, lat]; `h3-js` returns [lat, lng]. */
export function h3ToLngLat(h3Index: string): [number, number] {
  const [lat, lng] = cellToLatLng(h3Index);
  return [lng, lat];
}

export function initMaplibreMap(container: HTMLElement, anchorH3: string): maplibregl.Map {
  const center = h3ToLngLat(anchorH3);
  return new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
    center,
    zoom: 18,
  });
}
