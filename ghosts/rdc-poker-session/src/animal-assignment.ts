/**
 * Assign each seated player at a table a UNIQUE Hellmuth animal type
 * (mouse / lion / jackal / elephant / eagle) so the table always shows
 * a mix of styles. Each player computes their own per-type fitness from
 * their slider profile (`hellmuth-profile.ts`); this module collects
 * the fitness vectors from every player and runs the assignment.
 *
 * For ≤5 seats: brute-force optimal — enumerate every distinct
 * permutation of types-to-players and pick the one with maximum total
 * fitness. With 5 types and at most 5 players, that's ≤5! = 120
 * permutations. Trivial.
 *
 * For >5 seats: greedy with reuse — once all 5 types are taken, later
 * players get their best-fit type even if it duplicates. (RDC tables
 * are typically 4–6 seats so this rarely fires.)
 */

import type { AnimalType } from "./hellmuth-profile.js";

const ANIMAL_TYPES: AnimalType[] = ["mouse", "lion", "jackal", "elephant", "eagle"];

export interface PlayerFitness {
  readonly ghostId: string;
  readonly fitness: Readonly<Record<AnimalType, number>>;
}

/**
 * Optional constraints applied during reassignment after the
 * triennial reflection. For each constrained player either:
 *   - `pin: <type>` — they must keep this type (sticker)
 *   - `forbid: <type>` — they must NOT get this type (switcher)
 * Implemented by mutating their fitness vector before the brute force.
 */
export interface AssignmentConstraints {
  readonly pin?: ReadonlyMap<string, AnimalType>;
  readonly forbid?: ReadonlyMap<string, AnimalType>;
}

/**
 * Returns Map<ghostId, AnimalType>. Every player gets exactly one
 * type. For ≤5 players, types are unique; for >5, reuse is permitted
 * after all 5 are exhausted.
 */
export function assignAnimals(
  players: ReadonlyArray<PlayerFitness>,
  constraints: AssignmentConstraints = {},
): Map<string, AnimalType> {
  if (players.length === 0) return new Map();

  // Apply constraints by rewriting the per-player fitness vector.
  // pin → boost target type to a dominant value so the maximiser
  //       always picks it; zero out the others.
  // forbid → set the forbidden type's fitness to a very negative
  //          number so the maximiser never picks it.
  const adjusted: PlayerFitness[] = players.map((p) => {
    const pinned = constraints.pin?.get(p.ghostId);
    const forbidden = constraints.forbid?.get(p.ghostId);
    let f: Record<AnimalType, number> = { ...p.fitness };
    if (pinned) {
      f = { mouse: 0, lion: 0, jackal: 0, elephant: 0, eagle: 0 };
      f[pinned] = 100;
    } else if (forbidden) {
      f = { ...f, [forbidden]: -1 };
    }
    return { ghostId: p.ghostId, fitness: f };
  });

  if (adjusted.length <= 5) {
    return assignUnique(adjusted);
  }
  return assignWithReuse(adjusted);
}

function assignUnique(
  players: ReadonlyArray<PlayerFitness>,
): Map<string, AnimalType> {
  let bestScore = -Infinity;
  let bestAssignment = new Map<string, AnimalType>();

  for (const perm of pickPermutations(ANIMAL_TYPES, players.length)) {
    let total = 0;
    for (let i = 0; i < players.length; i++) {
      total += players[i]!.fitness[perm[i]!];
    }
    if (total > bestScore) {
      bestScore = total;
      bestAssignment = new Map(
        players.map((p, i) => [p.ghostId, perm[i]!] as const),
      );
    }
  }
  return bestAssignment;
}

function assignWithReuse(
  players: ReadonlyArray<PlayerFitness>,
): Map<string, AnimalType> {
  // First fill the 5 unique slots with the best fits, then let the
  // remaining players take their favourite type even if duplicated.
  const sortedPlayers = [...players].sort((a, b) => {
    const aMax = Math.max(...Object.values(a.fitness));
    const bMax = Math.max(...Object.values(b.fitness));
    return bMax - aMax;
  });
  const remainingTypes = new Set(ANIMAL_TYPES);
  const result = new Map<string, AnimalType>();
  for (const p of sortedPlayers) {
    let chosen: AnimalType = "lion";
    if (remainingTypes.size > 0) {
      let best = -Infinity;
      for (const t of remainingTypes) {
        if (p.fitness[t] > best) {
          best = p.fitness[t];
          chosen = t;
        }
      }
      remainingTypes.delete(chosen);
    } else {
      // All taken — take this player's overall favourite.
      let best = -Infinity;
      for (const t of ANIMAL_TYPES) {
        if (p.fitness[t] > best) {
          best = p.fitness[t];
          chosen = t;
        }
      }
    }
    result.set(p.ghostId, chosen);
  }
  return result;
}

/**
 * All permutations of `n` distinct items from `arr`.
 * `arr.length! / (arr.length - n)!` permutations total.
 */
function* pickPermutations<T>(arr: ReadonlyArray<T>, n: number): Generator<T[]> {
  if (n === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const tail of pickPermutations(rest, n - 1)) {
      yield [arr[i]!, ...tail];
    }
  }
}
