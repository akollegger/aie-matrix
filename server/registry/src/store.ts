import { randomUUID } from "node:crypto";

export interface GhostHouseRecord {
  id: string;
  displayName: string;
  baseUrl?: string;
  registeredAt: string;
}

export interface CaretakerRecord {
  id: string;
  label?: string;
}

export interface GhostRecord {
  id: string;
  ghostHouseId: string;
  caretakerId: string;
  h3Index: string;
  status: "active" | "stopped";
}

export interface RegistryStore {
  houses: Map<string, GhostHouseRecord>;
  caretakers: Map<string, CaretakerRecord>;
  ghosts: Map<string, GhostRecord>;
  /** caretaker → active ghost id */
  activeByCaretaker: Map<string, string>;
}

export function createRegistryStore(): RegistryStore {
  return {
    houses: new Map(),
    caretakers: new Map(),
    ghosts: new Map(),
    activeByCaretaker: new Map(),
  };
}

export function createCaretakerId(): string {
  return randomUUID();
}

export function createGhostHouseId(): string {
  return randomUUID();
}

export function createGhostId(): string {
  return randomUUID();
}
