import {
  deriveOwnerMnemonicFromMasterSecret,
  encodeNostrNpub,
  encodeNostrNsec,
  IdentityProvider,
  looksLikeSlip39Share,
  MasterSecretProvider,
  parseSlip39Share,
  recoverMasterSecretFromSlip39Share,
} from "@linky/core/identity";
import { Effect, Layer } from "effect";

export interface DerivedIdentity {
  /** BIP-39 mnemonic of the Evolu owner that archives telemetry. */
  evoluOwnerMnemonic: string;
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
    const masterSecret = await Effect.runPromise(
      recoverMasterSecretFromSlip39Share(share),
    );
    const identityLayer = Layer.provide(
      IdentityProvider.Live,
      MasterSecretProvider.make(masterSecret),
    );
    const identity = await Effect.runPromise(
      Effect.provide(IdentityProvider, identityLayer),
    );
    const [npub, nsec, evoluOwnerMnemonic] = await Promise.all([
      Effect.runPromise(encodeNostrNpub(identity.nostrPublicKey)),
      Effect.runPromise(encodeNostrNsec(identity.nostrSigningKey)),
      Effect.runPromise(
        deriveOwnerMnemonicFromMasterSecret(masterSecret, "analytics"),
      ),
    ]);

    return {
      evoluOwnerMnemonic,
      npub,
      nsec,
      privateKeyBytes: Uint8Array.from(identity.nostrSigningKey),
      publicKeyHex: String(identity.nostrPublicKey),
    };
  } catch {
    return null;
  }
};
