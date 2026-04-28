import maplibregl from "maplibre-gl";
import { cellToLatLng } from "h3-js";

export class GhostOverlay {
  private readonly markers = new Map<string, maplibregl.Marker>();

  constructor(private readonly map: maplibregl.Map) {}

  updateGhost(ghostId: string, h3Index: string): void {
    try {
      const [lat, lng] = cellToLatLng(h3Index);
      const lngLat: [number, number] = [lng, lat];
      let marker = this.markers.get(ghostId);
      if (!marker) {
        marker = new maplibregl.Marker({ color: "#7c5cff" }).setLngLat(lngLat).addTo(this.map);
        this.markers.set(ghostId, marker);
      } else {
        marker.setLngLat(lngLat);
      }
    } catch {
      console.warn("overlay: invalid h3Index for ghost", ghostId, h3Index);
    }
  }

  removeGhost(ghostId: string): void {
    const marker = this.markers.get(ghostId);
    if (marker) {
      marker.remove();
      this.markers.delete(ghostId);
    }
  }
}
