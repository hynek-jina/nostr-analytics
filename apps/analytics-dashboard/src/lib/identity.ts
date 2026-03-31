import {
  encodeNostrNpub,
  encodeNostrNsec,
  IdentityProvider,
  looksLikeSlip39Share,
  MasterSecretProvider,
  parseSlip39Share,
} from "@linky/core/identity";
import { Effect, Layer } from "effect";

export interface DerivedIdentity {
  npub: string;
  nsec: string;
  privateKeyBytes: Uint8Array;
  publicKeyHex: string;
}

export const normalizeSlip39Seed = (value: string): string => {
  return String(value)
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join(" ");
};

export const looksLikeSlip39Seed = (value: string): boolean => {
  return looksLikeSlip39Share(normalizeSlip39Seed(value));
};

export const deriveIdentityFromSlip39 = async (
  value: string,
): Promise<DerivedIdentity | null> => {
  try {
    const normalized = normalizeSlip39Seed(value);
    const share = await Effect.runPromise(parseSlip39Share(normalized));
    const identityLayer = Layer.provideMerge(
      IdentityProvider.Live,
      MasterSecretProvider.fromSlip39Share(share),
    );
    const identity = await Effect.runPromise(
      Effect.provide(IdentityProvider, identityLayer),
    );
    const [npub, nsec] = await Promise.all([
      Effect.runPromise(encodeNostrNpub(identity.nostrPublicKey)),
      Effect.runPromise(encodeNostrNsec(identity.nostrSigningKey)),
    ]);

    return {
      npub,
      nsec,
      privateKeyBytes: Uint8Array.from(identity.nostrSigningKey),
      publicKeyHex: String(identity.nostrPublicKey),
    };
  } catch {
    return null;
  }
};
