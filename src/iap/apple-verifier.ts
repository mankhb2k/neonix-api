import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { ApiError } from "../common/api-error";
import { env } from "../env";

// Apple root CAs live in api/certs (dist/iap → ../../certs, also in the Docker image).
const CERTS_DIR = join(__dirname, "../../certs");

let verifiers: SignedDataVerifier[] | null = null;

function getVerifiers(): SignedDataVerifier[] {
  if (verifiers) return verifiers;
  const rootCAs = readdirSync(CERTS_DIR)
    .filter((file) => file.endsWith(".cer"))
    .map((file) => readFileSync(join(CERTS_DIR, file)));
  verifiers = [
    // Apple requires the numeric app id to verify production signatures.
    ...(env.appleAppId ? [new SignedDataVerifier(rootCAs, false, Environment.PRODUCTION, env.appBundleId, env.appleAppId)] : []),
    new SignedDataVerifier(rootCAs, false, Environment.SANDBOX, env.appBundleId),
    // Xcode's StoreKit testing signs with a local certificate, so the library skips the signature check for this
    // environment: accepted only under DEV_AUTH_BYPASS (env.ts refuses that in production).
    ...(env.devAuthBypass ? [new SignedDataVerifier(rootCAs, false, Environment.XCODE, env.appBundleId)] : []),
  ];
  return verifiers;
}

// Production first, sandbox as fallback (App Review and TestFlight use sandbox).
async function verifyWithAny<T>(run: (verifier: SignedDataVerifier) => Promise<T>): Promise<T> {
  for (const verifier of getVerifiers()) {
    try {
      return await run(verifier);
    } catch {
      // wrong environment or bad signature: try the next verifier
    }
  }
  throw new ApiError(400, "Invalid Apple signed data", "INVALID_SIGNATURE");
}

export const decodeTransaction = (signed: string): Promise<JWSTransactionDecodedPayload> =>
  verifyWithAny((v) => v.verifyAndDecodeTransaction(signed));

export const decodeNotification = (signed: string): Promise<ResponseBodyV2DecodedPayload> =>
  verifyWithAny((v) => v.verifyAndDecodeNotification(signed));
