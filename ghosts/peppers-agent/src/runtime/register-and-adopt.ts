/**
 * Register a peppers ghost-house with the running combined server,
 * spawn a caretaker, and adopt one ghost — same flow random-house
 * uses, factored out so we can drop our LLM brain in its place.
 */

interface HouseResponse {
  readonly ghostHouseId: string;
}

interface CaretakerResponse {
  readonly caretakerId: string;
}

interface AdoptResponse {
  readonly ghostId: string;
  readonly caretakerId: string;
  readonly credential: {
    readonly token: string;
    readonly worldApiBaseUrl: string;
    readonly transport: string;
  };
}

/** Resolved per-ghost connection details after adoption. */
export interface AdoptedGhost {
  readonly ghostId: string;
  readonly caretakerId: string;
  readonly ghostHouseId: string;
  readonly worldApiBaseUrl: string;
  readonly token: string;
}

export interface RegisterAndAdoptOptions {
  readonly registryBase: string;
  readonly displayName?: string;
  readonly caretakerLabel?: string;
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `cannot reach registry at ${base}${path} (${msg}). Start the combined server first: pnpm run dev`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`registry ${path} failed (${res.status}): ${text}`);
  }
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function registerAndAdopt(
  opts: RegisterAndAdoptOptions,
): Promise<AdoptedGhost> {
  const ghostHouseId = await registerHouse({
    registryBase: opts.registryBase,
    displayName: opts.displayName,
  });
  return adoptUnderHouse({
    registryBase: opts.registryBase,
    ghostHouseId,
    caretakerLabel: opts.caretakerLabel,
  });
}

/**
 * Register a single ghost-house and return its id. When running multiple
 * peppers ghosts in one process, register the house ONCE and adopt all
 * ghosts under it — otherwise each ghost lives in its own house, and
 * the conversation router refuses cross-house thread reads (403), which
 * silently kills incoming utterances.
 */
export async function registerHouse(opts: {
  readonly registryBase: string;
  readonly displayName?: string;
}): Promise<string> {
  const displayName = opts.displayName ?? "peppers-house";
  const house = await postJson<HouseResponse>(opts.registryBase, "/registry/houses", {
    displayName,
  });
  return house.ghostHouseId;
}

/** Adopt one ghost under an already-registered house. */
export async function adoptUnderHouse(opts: {
  readonly registryBase: string;
  readonly ghostHouseId: string;
  readonly caretakerLabel?: string;
}): Promise<AdoptedGhost> {
  const caretakerLabel = opts.caretakerLabel ?? "peppers-caretaker";
  const caretaker = await postJson<CaretakerResponse>(opts.registryBase, "/registry/caretakers", {
    label: caretakerLabel,
  });
  const adopt = await postJson<AdoptResponse>(opts.registryBase, "/registry/adopt", {
    caretakerId: caretaker.caretakerId,
    ghostHouseId: opts.ghostHouseId,
  });
  return {
    ghostId: adopt.ghostId,
    caretakerId: adopt.caretakerId,
    ghostHouseId: opts.ghostHouseId,
    worldApiBaseUrl: adopt.credential.worldApiBaseUrl,
    token: adopt.credential.token,
  };
}
