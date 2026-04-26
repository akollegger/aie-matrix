import { basename } from "node:path";
import type { TmjDocument, TmjProperty } from "./parse-tmj.js";

export interface MapContext {
  readonly h3Anchor: string;
  readonly h3Resolution: 15;
  readonly elevation: number;
  readonly mapName: string;
  readonly mapStem: string;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly hexsidelength: number;
  readonly staggeraxis: "x" | "y";
  readonly staggerindex: "odd" | "even";
}

function getPropertyString(props: TmjProperty[] | undefined, name: string): string | undefined {
  const p = props?.find((x) => x.name === name);
  if (!p || p.value === undefined || p.value === null) {
    return undefined;
  }
  return String(p.value).trim();
}

function getPropertyInt(props: TmjProperty[] | undefined, name: string): number | undefined {
  const p = props?.find((x) => x.name === name);
  if (!p || p.value === undefined || p.value === null) {
    return undefined;
  }
  if (typeof p.value === "number" && Number.isFinite(p.value)) {
    return p.value;
  }
  const n = parseInt(String(p.value), 10);
  return Number.isFinite(n) ? n : undefined;
}

export type MapContextFailure =
  | { readonly _tag: "MissingH3Anchor"; readonly tmjPath: string }
  | { readonly _tag: "BadH3Resolution"; readonly tmjPath: string; readonly value: number };

export type MapContextResult = { readonly ok: true; readonly ctx: MapContext } | { readonly ok: false; readonly error: MapContextFailure };

export function extractMapContext(tmj: TmjDocument, tmjPath: string): MapContextResult {
  const anchor = getPropertyString(tmj.properties, "h3_anchor");
  if (!anchor) {
    return { ok: false, error: { _tag: "MissingH3Anchor", tmjPath } };
  }
  const res = getPropertyInt(tmj.properties, "h3_resolution") ?? 15;
  if (res !== 15) {
    return { ok: false, error: { _tag: "BadH3Resolution", tmjPath, value: res } };
  }
  const elevation = getPropertyInt(tmj.properties, "elevation") ?? 0;
  const mapName = getPropertyString(tmj.properties, "map_name") ?? basename(tmjPath).replace(/\.tmj$/i, "");
  const mapStem = basename(tmjPath).replace(/\.tmj$/i, "");
  return {
    ok: true,
    ctx: {
      h3Anchor: anchor,
      h3Resolution: 15,
      elevation,
      mapName,
      mapStem,
      tilewidth: tmj.tilewidth,
      tileheight: tmj.tileheight,
      hexsidelength: tmj.hexsidelength,
      staggeraxis: tmj.staggeraxis,
      staggerindex: tmj.staggerindex,
    },
  };
}
