export type paths = {
    readonly "/auth/logout": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Revoke the current owner session */
        readonly post: operations["OwnerAuthController_logout"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/auth/owner/login": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Login the singleton owner and record a check-in */
        readonly post: operations["OwnerAuthController_login"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/auth/owner/password-change": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Change the owner password and rotate the session */
        readonly post: operations["OwnerAuthController_changePassword"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/auth/session": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read the current owner session */
        readonly get: operations["OwnerAuthController_session"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/health/live": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["HealthController_live"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/health/ready": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get: operations["HealthController_ready"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/check-in-schedule": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read the current check-in schedule */
        readonly get: operations["OwnerController_schedule"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/check-ins": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Explicitly reauthenticate and record an owner check-in */
        readonly post: operations["OwnerController_checkIn"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List encrypted vault package versions */
        readonly get: operations["VaultController_list"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages/{packageId}/abort": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Abort an upload and remove its staging object */
        readonly post: operations["VaultController_abort"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages/{packageId}/activate": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Atomically activate a verified encrypted package */
        readonly post: operations["VaultController_activate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages/{packageId}/complete": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Verify the staged ciphertext and mark the package READY */
        readonly post: operations["VaultController_complete"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages/{packageId}/content": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /** Stream encrypted ciphertext into staging storage */
        readonly put: operations["VaultController_streamContent"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/packages/uploads": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create an encrypted vault package upload session */
        readonly post: operations["VaultController_createUploadSession"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/settings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read sanitized owner settings */
        readonly get: operations["OwnerController_settings"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /** Update owner settings after password reauthentication */
        readonly patch: operations["OwnerController_updateSettings"];
        readonly trace?: never;
    };
    readonly "/setup/owner": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create the singleton owner exactly once */
        readonly post: operations["SetupController_create"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/setup/status": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Get non-sensitive initialization status */
        readonly get: operations["SetupController_status"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        readonly ActivateVaultPackageDto: {
            /** Format: uuid */
            readonly expectedCurrentPackageId?: string;
            /** Format: uuid */
            readonly expectedShareGenerationId?: string;
            readonly password: string;
        };
        readonly ChangeOwnerPasswordDto: {
            readonly newOwnerVaultEnvelope: components["schemas"]["OwnerVaultEnvelopeDto"];
            readonly newPassword: string;
            readonly oldPassword: string;
            readonly vaultKeyProof?: string;
        };
        readonly CompleteVaultUploadDto: {
            readonly ciphertextSha256: string;
            /** Format: int64 */
            readonly ciphertextSize: number;
            readonly parts?: readonly components["schemas"]["VaultUploadPartDto"][];
            /** Format: uuid */
            readonly uploadId: string;
        };
        readonly CreateOwnerDto: {
            readonly backupEmail?: string;
            readonly displayName: string;
            readonly ownerVaultEnvelope: components["schemas"]["OwnerVaultEnvelopeDto"];
            readonly password: string;
            readonly primaryEmail: string;
            readonly setupToken: string;
        };
        readonly CreateVaultUploadDto: {
            /** @example XCHACHA20_POLY1305_SECRETSTREAM_V1 */
            readonly cipherAlgorithm: string;
            readonly ciphertextSha256: string;
            readonly clientCryptoVersion: string;
            /** @description Base64url encoded DEK envelope */
            readonly dekEnvelope: string;
            /** @description Base64url encoded DEK envelope AAD hash */
            readonly dekEnvelopeAadHash: string;
            readonly dekEnvelopeAlgorithm: string;
            /** @description Base64url encoded DEK envelope nonce */
            readonly dekEnvelopeNonce: string;
            readonly dekEnvelopeProtocolVersion: number;
            /** Format: int64 */
            readonly encryptedSize: number;
            /** @description Base64url encoded manifest AAD hash */
            readonly manifestAadHash: string;
            readonly manifestAlgorithm: string;
            /** @description Base64url encoded authenticated manifest */
            readonly manifestCiphertext: string;
            /** @description Base64url encoded manifest nonce */
            readonly manifestNonce: string;
            /** Format: uuid */
            readonly shareGenerationId: string;
            /** @description Base64url encoded secretstream header */
            readonly streamHeader: string;
            /** Format: uuid */
            readonly vaultId: string;
        };
        readonly OwnerCheckInDto: {
            readonly password: string;
        };
        readonly OwnerLoginDto: {
            readonly password: string;
        };
        readonly OwnerVaultEnvelopeDto: {
            /** Format: byte */
            readonly aadHash?: string;
            /** Format: byte */
            readonly ciphertext: string;
            /**
             * @example {
             *       "algorithm": "argon2id",
             *       "iterations": 3,
             *       "memoryKiB": 65536,
             *       "parallelism": 1,
             *       "purpose": "owner-vault-kek-v1",
             *       "version": 19
             *     }
             */
            readonly kdfParams: Record<string, never>;
            /** Format: byte */
            readonly kdfSalt: string;
            /** Format: byte */
            readonly keyVerifierCiphertext: string;
            /** Format: byte */
            readonly keyVerifierNonce: string;
            /** Format: byte */
            readonly nonce: string;
            /** Format: byte */
            readonly ownerEnvelopeProof: string;
            readonly vkCommitment: string;
        };
        readonly UpdateOwnerSettingsDto: {
            readonly missedDaysThreshold?: number;
            readonly password: string;
        };
        readonly VaultUploadPartDto: {
            readonly etag: string;
            readonly partNumber: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    readonly OwnerAuthController_logout: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 204: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerAuthController_login: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["OwnerLoginDto"];
            };
        };
        readonly responses: {
            /** @description Owner session created */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerAuthController_changePassword: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ChangeOwnerPasswordDto"];
            };
        };
        readonly responses: {
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerAuthController_session: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly HealthController_live: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly HealthController_ready: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerController_schedule: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerController_checkIn: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["OwnerCheckInDto"];
            };
        };
        readonly responses: {
            /** @description Check-in recorded */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_list: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "x-vault-id": string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Package versions */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_abort: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "idempotency-key": string;
                readonly "x-csrf-token": string;
                readonly "x-upload-id": string;
            };
            readonly path: {
                readonly packageId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Upload aborted */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_activate: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "idempotency-key": string;
                readonly "x-csrf-token": string;
            };
            readonly path: {
                readonly packageId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ActivateVaultPackageDto"];
            };
        };
        readonly responses: {
            /** @description Package is ACTIVE */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_complete: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "idempotency-key": string;
                readonly "x-csrf-token": string;
            };
            readonly path: {
                readonly packageId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CompleteVaultUploadDto"];
            };
        };
        readonly responses: {
            /** @description Package is READY */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_streamContent: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "content-length": string;
                readonly "content-type": string;
                readonly "idempotency-key": string;
                readonly "x-csrf-token": string;
                readonly "x-upload-id": string;
            };
            readonly path: {
                readonly packageId: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Ciphertext staged */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly VaultController_createUploadSession: {
        readonly parameters: {
            readonly query?: never;
            readonly header: {
                readonly "idempotency-key": string;
                readonly "x-csrf-token": string;
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateVaultUploadDto"];
            };
        };
        readonly responses: {
            /** @description Upload session created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerController_settings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly OwnerController_updateSettings: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UpdateOwnerSettingsDto"];
            };
        };
        readonly responses: {
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly SetupController_create: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateOwnerDto"];
            };
        };
        readonly responses: {
            /** @description Owner created and signed in */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly SetupController_status: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Initialization status */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
