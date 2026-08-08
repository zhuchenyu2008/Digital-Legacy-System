/* tslint:disable */
/* eslint-disable */

export function combinePedersen(shares: any, commitments: Uint8Array, context: Uint8Array): Uint8Array;

export function splitPedersen(secret: Uint8Array, threshold: number, share_count: number, context: Uint8Array): any;

export function verifyPedersenShare(share: Uint8Array, commitments: Uint8Array, context: Uint8Array): boolean;
