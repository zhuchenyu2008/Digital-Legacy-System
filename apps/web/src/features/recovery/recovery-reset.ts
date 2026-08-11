import { RecoveryCryptoWorkerSession } from "../../crypto/recovery-worker-session";
import { apiRequest } from "../../lib/api/browser-client";

type Request = <T>(path: string, init?: RequestInit) => Promise<T>;

type RecoverySession = Readonly<{
  createEphemeralKey(): Promise<string>;
  openRecoveryVault(
    input: Readonly<{
      workflowId: string;
      vaultId: string;
      sealed: string;
      sealedVaultKeyDigest: string;
      newPassword: string;
    }>,
  ): Promise<Readonly<{ envelope: Readonly<Record<string, unknown>>; vaultKeyProof: string }>>;
  close(): void;
}>;

type Dependencies = Readonly<{
  request: Request;
  createSession(): RecoverySession;
}>;

const defaults: Dependencies = {
  request: apiRequest,
  createSession: () => new RecoveryCryptoWorkerSession(),
};

export async function completeOwnerRecovery(
  input: Readonly<{
    token: string;
    emailVerificationCode: string;
    newPassword: string;
  }>,
  dependencies: Dependencies = defaults,
): Promise<void> {
  const session = dependencies.createSession();
  try {
    const clientEphemeralPublicKey = await session.createEphemeralKey();
    const material = await dependencies.request<{
      data: {
        workflowId: string;
        vaultId: string;
        resetSessionToken: string;
        encryptedVaultKey: string;
        sealedVaultKeyDigest: string;
        expiresAt: string;
      };
    }>("/auth/owner/password-recovery/material", {
      method: "POST",
      body: JSON.stringify({
        token: input.token,
        emailVerificationCode: input.emailVerificationCode,
        clientEphemeralPublicKey,
      }),
    });
    const replacement = await session.openRecoveryVault({
      workflowId: material.data.workflowId,
      vaultId: material.data.vaultId,
      sealed: material.data.encryptedVaultKey,
      sealedVaultKeyDigest: material.data.sealedVaultKeyDigest,
      newPassword: input.newPassword,
    });
    await dependencies.request("/auth/owner/password-recovery/reset", {
      method: "POST",
      body: JSON.stringify({
        resetSessionToken: material.data.resetSessionToken,
        newPassword: input.newPassword,
        newOwnerVaultEnvelope: replacement.envelope,
        vaultKeyProof: replacement.vaultKeyProof,
      }),
    });
  } finally {
    session.close();
  }
}
