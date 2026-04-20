export { loadHexMap, MapLoadError } from "./mapLoader.js";
export { MatrixRoom, type MatrixRoomOptions } from "./MatrixRoom.js";
export {
  TileCoord,
  WorldSpectatorState,
  WorldSyncState,
  type SpectatorStateSnapshot,
} from "./room-schema.js";
export {
  assignCompassToNeighbors,
  oddqOffsetToAxial,
  axialToOddqOffset,
  neighborOddq,
  COMPASS_AXIAL_DELTA,
} from "./hexCompass.js";
export { makeCellId, type CellId, type CellRecord, type LoadedMap } from "./mapTypes.js";
