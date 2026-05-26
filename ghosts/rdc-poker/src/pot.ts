/**
 * Side-pot calculation — vendored from pokerswarm-ai. See ../NOTICE.md.
 */

import type { Player, SidePot } from "./types.js";

function contributed(p: Player): number {
  return p.totalContributed ?? p.totalBetThisRound;
}

export function calculateSidePots(players: Player[]): SidePot[] {
  const activePlayers = players.filter(
    (p) => !p.isFolded && contributed(p) > 0,
  );

  if (activePlayers.length === 0) return [];

  const allInBets = activePlayers
    .filter((p) => p.isAllIn)
    .map((p) => contributed(p))
    .sort((a, b) => a - b);

  if (allInBets.length === 0) return [];

  const uniqueLevels = [...new Set([...allInBets])];
  const pots: SidePot[] = [];
  let previousLevel = 0;

  for (const level of uniqueLevels) {
    const contribution = level - previousLevel;
    let potAmount = 0;
    const eligible: string[] = [];

    for (const player of activePlayers) {
      const c = contributed(player);
      if (c >= level) {
        potAmount += contribution;
        eligible.push(player.id);
      } else if (c > previousLevel) {
        potAmount += c - previousLevel;
        eligible.push(player.id);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    }
    previousLevel = level;
  }

  const maxAllIn = Math.max(...allInBets);
  let remainingPot = 0;
  const remainingEligible: string[] = [];

  for (const player of activePlayers) {
    const c = contributed(player);
    if (c > maxAllIn) {
      remainingPot += c - maxAllIn;
      remainingEligible.push(player.id);
    } else if (c === maxAllIn && !player.isAllIn) {
      remainingEligible.push(player.id);
    }
  }

  if (remainingPot > 0 && remainingEligible.length > 0) {
    pots.push({ amount: remainingPot, eligiblePlayerIds: remainingEligible });
  }

  return pots;
}
