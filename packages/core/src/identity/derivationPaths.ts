import type { OwnerLaneIndex } from "./domain";

export const NOSTR_PATH = "m/44'/1237'/0'/0/0";
export const CASHU_SEED_PATH = "m/83696968'/39'/0'/24'/0'";
export const META_OWNER_PATH = "m/83696968'/39'/0'/24'/1'/0'";

// Evolu owner for the analytics dashboard's telemetry archive. Linky reserves
// the low child indexes (1' meta … 7' error tracker) for the app itself, so the
// analytics tooling lives far away from that range to avoid ever sharing an
// owner with a Linky database derived from the same seed.
export const ANALYTICS_OWNER_PATH = "m/83696968'/39'/0'/24'/100'/0'";

export const contactsOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/2'/${index}'`;

export const cashuOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/3'/${index}'`;

export const messagesOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/4'/${index}'`;
