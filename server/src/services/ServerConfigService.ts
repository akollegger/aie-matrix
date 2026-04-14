import { isEnvTruthy } from "@aie-matrix/root-env";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Layer } from "effect";

const servicesDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(servicesDir, "..", "..", "..");

export interface ServerConfig {
  readonly httpPort: number;
  readonly mapPath: string;
  readonly mapsRoot: string;
  readonly corsHeaders: Record<string, string>;
  readonly debugEnabled: boolean;
}

export class ServerConfigService extends Context.Tag("aie-matrix/ServerConfigService")<
  ServerConfigService,
  ServerConfig
>() {}

/** Default CORS headers aligned with `server/src/index.ts` (PoC browser clients). */
const defaultCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, mcp-protocol-version, X-Requested-With, Origin",
  "Access-Control-Max-Age": "86400",
};

export function parseServerConfigFromEnv(env: NodeJS.ProcessEnv): ServerConfig {
  const httpPort = Number(env.AIE_MATRIX_HTTP_PORT ?? "8787");
  const mapPath =
    env.AIE_MATRIX_MAP ?? join(repoRoot, "maps/sandbox/freeplay.tmj");
  const mapsRoot = normalize(join(repoRoot, "maps"));
  return {
    httpPort,
    mapPath,
    mapsRoot,
    corsHeaders: defaultCorsHeaders,
    debugEnabled: isEnvTruthy(env.AIE_MATRIX_DEBUG),
  };
}

export const makeServerConfigLayer = (env: NodeJS.ProcessEnv): Layer.Layer<ServerConfigService> =>
  Layer.succeed(ServerConfigService, parseServerConfigFromEnv(env));
