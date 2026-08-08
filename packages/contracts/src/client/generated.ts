export type paths = {
    readonly "/auth/contact/login": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Login an emergency contact */
        readonly post: operations["ContactAuthController_login"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
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
    readonly "/contact-invitations/accept": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Accept an invitation with consent and a wrapped private key */
        readonly post: operations["ContactInvitationsController_accept"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/contact-invitations/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Resolve an invitation token supplied in the request body */
        readonly post: operations["ContactInvitationsController_resolve"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/contact/crypto-material": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read the authenticated contact crypto material */
        readonly get: operations["ContactInvitationsController_cryptoMaterial"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/contacts/password-change/complete": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Rotate the contact password and wrapped private key */
        readonly post: operations["ContactPasswordController_complete"];
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
    readonly "/owner/contacts/{contactId}/invitation/resend": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Revoke and resend a contact invitation */
        readonly post: operations["ContactInvitationsController_resend"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/contacts/{contactId}/password-change-invitation": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Issue a one-time contact password-change invitation */
        readonly post: operations["ContactInvitationsController_requestPasswordChange"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/contacts/{contactId}/remove": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Remove an emergency contact and require share regeneration */
        readonly post: operations["ContactInvitationsController_remove"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/contacts/invitations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create a one-time emergency contact invitation */
        readonly post: operations["ContactInvitationsController_invite"];
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
    readonly "/owner/vault/share-generations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create a share generation draft and return the roster snapshot */
        readonly post: operations["ShareGenerationController_create"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/vault/share-generations/{generationId}/activate": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Atomically activate a complete share generation */
        readonly post: operations["ShareGenerationController_activate"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/vault/share-generations/{generationId}/material": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Read public material needed to build a share generation */
        readonly get: operations["ShareGenerationController_material"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/owner/vault/share-generations/{generationId}/upload": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Validate and store the encrypted shares for a draft */
        readonly post: operations["ShareGenerationController_upload"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
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
        readonly AcceptContactInvitationDto: {
            readonly consent: components["schemas"]["ContactConsentDto"];
            readonly password: string;
            readonly privateKeyEnvelope: components["schemas"]["ContactPrivateKeyEnvelopeDto"];
            readonly token: string;
        };
        readonly ActivateShareGenerationDto: {
            readonly contactSetVersion: number;
            /** Format: uuid */
            readonly expectedCurrentGenerationId?: string;
        };
        readonly ActivateVaultPackageDto: {
            /** Format: uuid */
            readonly expectedCurrentPackageId?: string;
            /** Format: uuid */
            readonly expectedShareGenerationId?: string;
            readonly password: string;
        };
        readonly ChangeContactPasswordDto: {
            readonly newPassword: string;
            readonly newPrivateKeyEnvelope: components["schemas"]["ContactPrivateKeyEnvelopeDto"];
            readonly oldPassword: string;
            readonly token?: string;
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
        readonly ContactConsentDto: {
            readonly denialDisclosureAccepted: boolean;
            readonly documentSha256: string;
            readonly privacyAccepted: boolean;
            readonly stage2LockAccepted: boolean;
            readonly termsAccepted: boolean;
            readonly version: string;
        };
        readonly ContactLoginDto: {
            readonly displayName: string;
            readonly entryToken?: string;
            readonly password: string;
        };
        readonly ContactPrivateKeyEnvelopeDto: {
            /** Format: byte */
            readonly ciphertext: string;
            readonly kdfParams: Record<string, never>;
            /** Format: byte */
            readonly kdfSalt: string;
            /** Format: byte */
            readonly nonce: string;
            /** Format: byte */
            readonly privateKeyProof: string;
            /** Format: byte */
            readonly publicKey: string;
        };
        readonly CreateContactInvitationDto: {
            readonly displayName: string;
            /** Format: email */
            readonly email: string;
        };
        readonly CreateOwnerDto: {
            readonly backupEmail?: string;
            readonly displayName: string;
            readonly ownerVaultEnvelope: components["schemas"]["OwnerVaultEnvelopeDto"];
            readonly password: string;
            readonly primaryEmail: string;
            readonly setupToken: string;
        };
        readonly CreateShareGenerationDto: {
            readonly contactSetVersion: number;
            /** Format: uuid */
            readonly expectedCurrentGenerationId?: string;
            /** Format: uuid */
            readonly vaultId: string;
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
        readonly RemoveContactDto: {
            readonly password: string;
        };
        readonly RequestContactPasswordChangeDto: {
            readonly password: string;
        };
        readonly ResolveContactInvitationDto: {
            readonly token: string;
        };
        readonly ShareGenerationShareDto: {
            /** Format: uuid */
            readonly contactId: string;
            /** Format: byte */
            readonly deathShareCiphertext: string;
            /** Format: byte */
            readonly deathShareCommitment: string;
            /** Format: byte */
            readonly recoveryShareCiphertext: string;
            /** Format: byte */
            readonly recoveryShareCommitment: string;
            readonly shareIndex: number;
        };
        readonly UpdateOwnerSettingsDto: {
            readonly missedDaysThreshold?: number;
            readonly password: string;
        };
        readonly UploadShareGenerationDto: {
            readonly contactSetVersion: number;
            readonly contactsSnapshotSha256: string;
            /** Format: byte */
            readonly generationCommitment: string;
            /** Format: byte */
            readonly generationProof: string;
            readonly protocolVersion: number;
            readonly shares: readonly components["schemas"]["ShareGenerationShareDto"][];
            readonly vkCommitment: string;
            readonly vssScheme: string;
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
    readonly ContactAuthController_login: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ContactLoginDto"];
            };
        };
        readonly responses: {
            /** @description Contact session created */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
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
    readonly ContactInvitationsController_accept: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["AcceptContactInvitationDto"];
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
    readonly ContactInvitationsController_resolve: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ResolveContactInvitationDto"];
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
    readonly ContactInvitationsController_cryptoMaterial: {
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
    readonly ContactPasswordController_complete: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ChangeContactPasswordDto"];
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
    readonly ContactInvitationsController_resend: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly contactId: unknown;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly ContactInvitationsController_requestPasswordChange: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly contactId: unknown;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RequestContactPasswordChangeDto"];
            };
        };
        readonly responses: {
            readonly 202: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readonly ContactInvitationsController_remove: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly contactId: unknown;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RemoveContactDto"];
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
    readonly ContactInvitationsController_invite: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateContactInvitationDto"];
            };
        };
        readonly responses: {
            /** @description Invitation queued */
            readonly 202: {
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
    readonly ShareGenerationController_create: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["CreateShareGenerationDto"];
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
    readonly ShareGenerationController_activate: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly generationId: unknown;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ActivateShareGenerationDto"];
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
    readonly ShareGenerationController_material: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly generationId: unknown;
            };
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
    readonly ShareGenerationController_upload: {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly generationId: unknown;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["UploadShareGenerationDto"];
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
