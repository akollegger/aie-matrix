import { readFile } from "node:fs/promises";

export interface TmjProperty {
  readonly name: string;
  readonly type?: string;
  readonly value: string | number | boolean | undefined;
}

export interface TmjTilesetRef {
  readonly firstgid: number;
  readonly source: string;
}

export interface TmjLayer {
  readonly type?: string;
  readonly class?: string;
  readonly name?: string;
  readonly width: number;
  readonly height: number;
  readonly data?: number[];
  readonly objects?: TmjObject[];
}

export interface TmjObject {
  readonly id: number;
  readonly name?: string;
  readonly type?: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly ellipse?: boolean;
  readonly polygon?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface TmjDocument {
  readonly width: number;
  readonly height: number;
  readonly tilewidth: number;
  readonly tileheight: number;
  readonly hexsidelength: number;
  readonly staggeraxis: "x" | "y";
  readonly staggerindex: "odd" | "even";
  readonly properties?: TmjProperty[];
  readonly layers?: TmjLayer[];
  readonly tilesets?: TmjTilesetRef[];
}

function asNum(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

function asStr(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

function parseLayer(raw: unknown): TmjLayer | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const width = asNum(o.width, 0);
  const height = asNum(o.height, 0);
  const data = Array.isArray(o.data) ? o.data.map((n) => asNum(n, 0)) : undefined;
  const objects = Array.isArray(o.objects) ? o.objects.map(parseObject).filter((x): x is TmjObject => x !== undefined) : undefined;
  return {
    type: asStr(o.type),
    class: asStr(o.class),
    name: asStr(o.name),
    width,
    height,
    data,
    objects,
  };
}

function parseObject(raw: unknown): TmjObject | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const id = asNum(o.id, NaN);
  if (!Number.isFinite(id)) {
    return undefined;
  }
  const polyRaw = o.polygon;
  const polygon = Array.isArray(polyRaw)
    ? polyRaw
        .map((p) => {
          if (typeof p !== "object" || p === null) {
            return undefined;
          }
          const pr = p as Record<string, unknown>;
          return { x: asNum(pr.x, 0), y: asNum(pr.y, 0) };
        })
        .filter((p): p is { x: number; y: number } => p !== undefined)
    : undefined;
  return {
    id,
    name: asStr(o.name),
    type: asStr(o.type),
    x: asNum(o.x, 0),
    y: asNum(o.y, 0),
    width: o.width !== undefined ? asNum(o.width, 0) : undefined,
    height: o.height !== undefined ? asNum(o.height, 0) : undefined,
    ellipse: o.ellipse === true,
    polygon,
  };
}

export async function parseTmjFile(path: string): Promise<TmjDocument> {
  const text = await readFile(path, "utf8");
  const json = JSON.parse(text) as Record<string, unknown>;
  const staggeraxisRaw = asStr(json.staggeraxis);
  const staggerindexRaw = asStr(json.staggerindex);
  const staggeraxis = staggeraxisRaw === "y" ? "y" : "x";
  const staggerindex = staggerindexRaw === "even" ? "even" : "odd";
  const propsRaw = Array.isArray(json.properties)
    ? (json.properties as unknown[]).map((p) => {
        if (typeof p !== "object" || p === null) {
          return undefined;
        }
        const pr = p as Record<string, unknown>;
        const name = asStr(pr.name);
        if (!name) {
          return undefined;
        }
        const prop: TmjProperty = {
          name,
          ...(asStr(pr.type) !== undefined ? { type: asStr(pr.type) } : {}),
          value: pr.value as string | number | boolean | undefined,
        };
        return prop;
      })
    : undefined;
  const props = propsRaw?.filter((p): p is TmjProperty => p !== undefined);
  const layers = Array.isArray(json.layers)
    ? (json.layers as unknown[]).map(parseLayer).filter((l): l is TmjLayer => l !== undefined)
    : undefined;
  const tilesets = Array.isArray(json.tilesets)
    ? (json.tilesets as unknown[])
        .map((t) => {
          if (typeof t !== "object" || t === null) {
            return undefined;
          }
          const tr = t as Record<string, unknown>;
          const source = asStr(tr.source);
          if (!source) {
            return undefined;
          }
          return { firstgid: asNum(tr.firstgid, 0), source } satisfies TmjTilesetRef;
        })
        .filter((t): t is TmjTilesetRef => t !== undefined && t.firstgid > 0)
    : undefined;

  return {
    width: asNum(json.width, 0),
    height: asNum(json.height, 0),
    tilewidth: asNum(json.tilewidth, 0),
    tileheight: asNum(json.tileheight, 0),
    hexsidelength: asNum(json.hexsidelength, 0),
    staggeraxis,
    staggerindex,
    properties: props,
    layers,
    tilesets,
  };
}
