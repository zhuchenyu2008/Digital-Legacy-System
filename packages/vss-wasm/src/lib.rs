use core::fmt;

#[cfg(feature = "test-vectors")]
use rand_chacha::ChaCha20Rng;
#[cfg(feature = "test-vectors")]
use rand_core::SeedableRng;
use rand_core::{CryptoRng, OsRng, RngCore};
use serde::Serialize;
use sha2::{Digest, Sha256};
use vsss_rs::curve25519::{WrappedRistretto, WrappedScalar};
use vsss_rs::{
    FeldmanVerifierSet, IdentifierPrimeField, PedersenResult, PedersenVerifierSet,
    ReadableShareSet, Share, ShareElement, ValueGroup,
};
use wasm_bindgen::prelude::*;

const SECRET_BYTES: usize = 32;
const SCALAR_BYTES: usize = 32;
const GROUP_BYTES: usize = 32;
const MAX_SHARE_COUNT: u16 = 32;
const MAX_CONTEXT_BYTES: usize = 4096;
const SHARE_MAGIC: &[u8; 4] = b"DLSH";
const COMMITMENTS_MAGIC: &[u8; 4] = b"DLSC";
const WIRE_VERSION: u8 = 1;
const SHARE_FIXED_HEADER_BYTES: usize = 4 + 1 + 1 + 2 + 2 + 32;
const COMMITMENTS_FIXED_HEADER_BYTES: usize = 4 + 1 + 1 + 2 + 2 + 32 + 1;

type Scalar = IdentifierPrimeField<WrappedScalar>;
type ScalarShare = (Scalar, Scalar);
type Verifier = ValueGroup<WrappedRistretto>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VssError {
    InvalidParameters,
    InvalidLength,
    InvalidEncoding,
    ContextMismatch,
    InvalidShare,
    InsufficientShares,
}

impl fmt::Display for VssError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidParameters => "invalid VSS parameters",
            Self::InvalidLength => "invalid VSS buffer length",
            Self::InvalidEncoding => "invalid VSS encoding",
            Self::ContextMismatch => "VSS context does not match",
            Self::InvalidShare => "invalid VSS share",
            Self::InsufficientShares => "not enough VSS shares",
        };
        f.write_str(message)
    }
}

impl std::error::Error for VssError {}

#[derive(Debug, Clone, Serialize)]
pub struct VssSplit {
    pub shares: Vec<Vec<u8>>,
    pub commitments: Vec<u8>,
}

#[derive(Debug)]
struct CommitmentSet {
    threshold: u16,
    share_count: u16,
    context_digest: [u8; 32],
    lanes: [CommitmentLane; 2],
}

#[derive(Debug)]
struct CommitmentLane {
    secret_generator: Verifier,
    blinder_generator: Verifier,
    feldman_verifiers: Vec<Verifier>,
    pedersen_verifiers: Vec<Verifier>,
}

#[derive(Debug)]
struct ParsedShare {
    threshold: u16,
    share_count: u16,
    context_digest: [u8; 32],
    identifier: Scalar,
    values: [Scalar; 2],
    blinders: [Scalar; 2],
}

pub fn split_pedersen(
    secret: &[u8],
    threshold: u32,
    share_count: u32,
    context: &[u8],
) -> Result<VssSplit, VssError> {
    let (threshold, share_count) = validate_parameters(secret, threshold, share_count, context)?;
    split_pedersen_with_rng(
        secret,
        threshold,
        share_count,
        context_digest(context),
        [OsRng, OsRng],
    )
}

fn split_pedersen_with_rng<R: RngCore + CryptoRng>(
    secret: &[u8],
    threshold: u16,
    share_count: u16,
    context_digest: [u8; 32],
    rngs: [R; 2],
) -> Result<VssSplit, VssError> {
    let [first_rng, second_rng] = rngs;
    let lane_results = [
        split_scalar_lane(&secret[..16], threshold, share_count, first_rng)?,
        split_scalar_lane(&secret[16..], threshold, share_count, second_rng)?,
    ];
    let commitments = encode_commitments(threshold, share_count, context_digest, &lane_results)?;

    let shares = (0..share_count as usize)
        .map(|index| {
            let first_share = &lane_results[0].secret_shares[index];
            let second_share = &lane_results[1].secret_shares[index];
            let first_blinder = &lane_results[0].blinder_shares[index];
            let second_blinder = &lane_results[1].blinder_shares[index];
            if first_share.identifier() != second_share.identifier()
                || first_blinder.identifier() != first_share.identifier()
                || second_blinder.identifier() != first_share.identifier()
            {
                return Err(VssError::InvalidEncoding);
            }
            encode_share(
                threshold,
                share_count,
                context_digest,
                first_share.identifier(),
                [first_share.value().clone(), second_share.value().clone()],
                [
                    first_blinder.value().clone(),
                    second_blinder.value().clone(),
                ],
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(VssSplit {
        shares,
        commitments,
    })
}

#[cfg(feature = "test-vectors")]
pub fn split_pedersen_test_vector(
    secret: &[u8],
    threshold: u32,
    share_count: u32,
    context: &[u8],
) -> Result<VssSplit, VssError> {
    let (threshold, share_count) = validate_parameters(secret, threshold, share_count, context)?;
    let mut first_seed = [0u8; 32];
    let mut second_seed = [0u8; 32];
    first_seed.fill(0x11);
    second_seed.fill(0x22);
    split_pedersen_with_rng(
        secret,
        threshold,
        share_count,
        context_digest(context),
        [
            ChaCha20Rng::from_seed(first_seed),
            ChaCha20Rng::from_seed(second_seed),
        ],
    )
}

pub fn verify_pedersen_share(share: &[u8], commitments: &[u8], context: &[u8]) -> bool {
    verify_pedersen_share_inner(share, commitments, context).is_ok()
}

pub fn combine_pedersen(
    shares: &[Vec<u8>],
    commitments: &[u8],
    context: &[u8],
) -> Result<Vec<u8>, VssError> {
    let commitment_set = parse_commitments(commitments, context)?;
    if shares.len() < commitment_set.threshold as usize {
        return Err(VssError::InsufficientShares);
    }
    if shares.len() > commitment_set.share_count as usize {
        return Err(VssError::InvalidParameters);
    }

    let mut parsed_shares = Vec::with_capacity(shares.len());
    for encoded_share in shares {
        let parsed = parse_share(encoded_share, context)?;
        validate_share_metadata(&parsed, &commitment_set)?;
        parsed_shares.push(parsed);
    }

    let mut secret_shares = Vec::with_capacity(parsed_shares.len());
    for parsed in &parsed_shares {
        for lane_index in 0..2 {
            let lane = &commitment_set.lanes[lane_index];
            let feldman_set = <Vec<Verifier> as FeldmanVerifierSet<ScalarShare, Verifier>>::
                feldman_set_with_generator_and_verifiers(
                    lane.secret_generator,
                    &lane.feldman_verifiers,
                );
            feldman_set
                .verify_share(&(parsed.identifier, parsed.values[lane_index]))
                .map_err(|_| VssError::InvalidShare)?;
            let verifier_set = <Vec<Verifier> as PedersenVerifierSet<ScalarShare, Verifier>>::
                pedersen_set_with_generators_and_verifiers(
                    lane.secret_generator,
                    lane.blinder_generator,
                    &lane.pedersen_verifiers,
                );
            verifier_set
                .verify_share_and_blinder(
                    &(parsed.identifier, parsed.values[lane_index]),
                    &(parsed.identifier, parsed.blinders[lane_index]),
                )
                .map_err(|_| VssError::InvalidShare)?;
        }
        secret_shares.push((parsed.identifier, parsed.values[0]));
    }

    let first = secret_shares.combine().map_err(|error| {
        if matches!(error, vsss_rs::Error::SharingMinThreshold) {
            VssError::InsufficientShares
        } else {
            VssError::InvalidShare
        }
    })?;
    let second_shares = parsed_shares
        .iter()
        .map(|parsed| (parsed.identifier, parsed.values[1]))
        .collect::<Vec<_>>();
    let second = second_shares.combine().map_err(|error| {
        if matches!(error, vsss_rs::Error::SharingMinThreshold) {
            VssError::InsufficientShares
        } else {
            VssError::InvalidShare
        }
    })?;
    let mut recovered = Vec::with_capacity(SECRET_BYTES);
    recovered.extend_from_slice(&first.to_vec()[..16]);
    recovered.extend_from_slice(&second.to_vec()[..16]);
    Ok(recovered)
}

#[wasm_bindgen(js_name = splitPedersen)]
pub fn split_pedersen_wasm(
    secret: &[u8],
    threshold: u32,
    share_count: u32,
    context: &[u8],
) -> Result<JsValue, JsValue> {
    let split = split_pedersen(secret, threshold, share_count, context)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    serde_wasm_bindgen::to_value(&split).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = verifyPedersenShare)]
pub fn verify_pedersen_share_wasm(share: &[u8], commitments: &[u8], context: &[u8]) -> bool {
    verify_pedersen_share(share, commitments, context)
}

#[wasm_bindgen(js_name = combinePedersen)]
pub fn combine_pedersen_wasm(
    shares: JsValue,
    commitments: &[u8],
    context: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let shares: Vec<Vec<u8>> = serde_wasm_bindgen::from_value(shares)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    combine_pedersen(&shares, commitments, context)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn verify_pedersen_share_inner(
    share: &[u8],
    commitments: &[u8],
    context: &[u8],
) -> Result<(), VssError> {
    let commitment_set = parse_commitments(commitments, context)?;
    let parsed_share = parse_share(share, context)?;
    validate_share_metadata(&parsed_share, &commitment_set)?;
    for lane_index in 0..2 {
        let lane = &commitment_set.lanes[lane_index];
        let feldman_set = <Vec<Verifier> as FeldmanVerifierSet<ScalarShare, Verifier>>::
            feldman_set_with_generator_and_verifiers(
                lane.secret_generator,
                &lane.feldman_verifiers,
            );
        feldman_set
            .verify_share(&(parsed_share.identifier, parsed_share.values[lane_index]))
            .map_err(|_| VssError::InvalidShare)?;
        let verifier_set = <Vec<Verifier> as PedersenVerifierSet<ScalarShare, Verifier>>::
            pedersen_set_with_generators_and_verifiers(
                lane.secret_generator,
                lane.blinder_generator,
                &lane.pedersen_verifiers,
            );
        verifier_set
            .verify_share_and_blinder(
                &(parsed_share.identifier, parsed_share.values[lane_index]),
                &(parsed_share.identifier, parsed_share.blinders[lane_index]),
            )
            .map_err(|_| VssError::InvalidShare)?;
    }
    Ok(())
}

fn validate_parameters(
    secret: &[u8],
    threshold: u32,
    share_count: u32,
    context: &[u8],
) -> Result<(u16, u16), VssError> {
    if secret.len() != SECRET_BYTES
        || context.is_empty()
        || context.len() > MAX_CONTEXT_BYTES
        || threshold < 2
        || threshold > share_count
        || share_count > u32::from(MAX_SHARE_COUNT)
    {
        return Err(VssError::InvalidParameters);
    }
    let threshold = u16::try_from(threshold).map_err(|_| VssError::InvalidParameters)?;
    let share_count = u16::try_from(share_count).map_err(|_| VssError::InvalidParameters)?;
    Ok((threshold, share_count))
}

fn context_digest(context: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"DLS-PEDERSEN-VSS-CONTEXT-V1\0");
    hasher.update((context.len() as u32).to_be_bytes());
    hasher.update(context);
    hasher.finalize().into()
}

fn encode_share(
    threshold: u16,
    share_count: u16,
    context_digest: [u8; 32],
    identifier: &Scalar,
    values: [Scalar; 2],
    blinders: [Scalar; 2],
) -> Result<Vec<u8>, VssError> {
    let mut encoded = Vec::with_capacity(SHARE_FIXED_HEADER_BYTES + SCALAR_BYTES * 5);
    encoded.extend_from_slice(SHARE_MAGIC);
    encoded.push(WIRE_VERSION);
    encoded.push(0);
    encoded.extend_from_slice(&threshold.to_be_bytes());
    encoded.extend_from_slice(&share_count.to_be_bytes());
    encoded.extend_from_slice(&context_digest);
    encoded.extend_from_slice(&identifier.to_vec());
    for value in values {
        encoded.extend_from_slice(&value.to_vec());
    }
    for blinder in blinders {
        encoded.extend_from_slice(&blinder.to_vec());
    }
    if encoded.len() != SHARE_FIXED_HEADER_BYTES + SCALAR_BYTES * 5 {
        return Err(VssError::InvalidEncoding);
    }
    Ok(encoded)
}

struct LaneResult {
    secret_shares: Vec<ScalarShare>,
    blinder_shares: Vec<ScalarShare>,
    feldman_verifiers: Vec<Verifier>,
    pedersen_verifiers: Vec<Verifier>,
    secret_generator: Verifier,
    blinder_generator: Verifier,
}

fn split_scalar_lane(
    secret_bytes: &[u8],
    threshold: u16,
    share_count: u16,
    rng: impl RngCore + CryptoRng,
) -> Result<LaneResult, VssError> {
    let mut scalar_bytes = [0u8; SCALAR_BYTES];
    scalar_bytes[..16].copy_from_slice(secret_bytes);
    let secret = Scalar::from_slice(&scalar_bytes).map_err(|_| VssError::InvalidEncoding)?;
    let result = vsss_rs::pedersen::split_secret::<ScalarShare, Verifier>(
        threshold as usize,
        share_count as usize,
        &secret,
        None,
        None,
        None,
        rng,
    )
    .map_err(|_| VssError::InvalidParameters)?;
    let pedersen_set = result.pedersen_verifier_set();
    let feldman_set = result.feldman_verifier_set();
    let secret_generator =
        <Vec<Verifier> as PedersenVerifierSet<ScalarShare, Verifier>>::secret_generator(
            pedersen_set,
        );
    let blinder_generator =
        <Vec<Verifier> as PedersenVerifierSet<ScalarShare, Verifier>>::blinder_generator(
            pedersen_set,
        );
    let feldman_generator =
        <Vec<Verifier> as FeldmanVerifierSet<ScalarShare, Verifier>>::generator(feldman_set);
    if secret_generator != feldman_generator {
        return Err(VssError::InvalidEncoding);
    }
    Ok(LaneResult {
        secret_shares: result.secret_shares().clone(),
        blinder_shares: result.blinder_shares().clone(),
        feldman_verifiers: <Vec<Verifier> as FeldmanVerifierSet<ScalarShare, Verifier>>::verifiers(
            feldman_set,
        )
        .to_vec(),
        pedersen_verifiers:
            <Vec<Verifier> as PedersenVerifierSet<ScalarShare, Verifier>>::blind_verifiers(
                pedersen_set,
            )
            .to_vec(),
        secret_generator,
        blinder_generator,
    })
}

fn encode_commitments(
    threshold: u16,
    share_count: u16,
    context_digest: [u8; 32],
    lanes: &[LaneResult; 2],
) -> Result<Vec<u8>, VssError> {
    if lanes.iter().any(|lane| {
        lane.feldman_verifiers.len() != threshold as usize
            || lane.pedersen_verifiers.len() != threshold as usize
    }) {
        return Err(VssError::InvalidEncoding);
    }
    let lane_bytes = 2 * GROUP_BYTES + 2 * 2 + threshold as usize * GROUP_BYTES * 2;
    let capacity = COMMITMENTS_FIXED_HEADER_BYTES + 2 * lane_bytes;
    let mut encoded = Vec::with_capacity(capacity);
    encoded.extend_from_slice(COMMITMENTS_MAGIC);
    encoded.push(WIRE_VERSION);
    encoded.push(0);
    encoded.extend_from_slice(&threshold.to_be_bytes());
    encoded.extend_from_slice(&share_count.to_be_bytes());
    encoded.extend_from_slice(&context_digest);
    encoded.push(2);
    for lane in lanes {
        encoded.extend_from_slice(&lane.secret_generator.to_vec());
        encoded.extend_from_slice(&lane.blinder_generator.to_vec());
        encoded.extend_from_slice(&threshold.to_be_bytes());
        encoded.extend_from_slice(&threshold.to_be_bytes());
        for verifier in &lane.feldman_verifiers {
            encoded.extend_from_slice(&verifier.to_vec());
        }
        for verifier in &lane.pedersen_verifiers {
            encoded.extend_from_slice(&verifier.to_vec());
        }
    }
    if encoded.len() != capacity {
        return Err(VssError::InvalidEncoding);
    }
    Ok(encoded)
}

fn parse_share(encoded: &[u8], context: &[u8]) -> Result<ParsedShare, VssError> {
    let expected_len = SHARE_FIXED_HEADER_BYTES + SCALAR_BYTES * 5;
    if encoded.len() != expected_len
        || &encoded[..4] != SHARE_MAGIC
        || encoded[4] != WIRE_VERSION
        || encoded[5] != 0
    {
        return Err(VssError::InvalidLength);
    }
    let threshold = u16::from_be_bytes([encoded[6], encoded[7]]);
    let share_count = u16::from_be_bytes([encoded[8], encoded[9]]);
    let mut context_digest_value = [0u8; 32];
    context_digest_value.copy_from_slice(&encoded[10..42]);
    if context_digest_value != context_digest(context) {
        return Err(VssError::ContextMismatch);
    }
    let identifier = Scalar::from_slice(&encoded[42..74]).map_err(|_| VssError::InvalidEncoding)?;
    let first_value =
        Scalar::from_slice(&encoded[74..106]).map_err(|_| VssError::InvalidEncoding)?;
    let second_value =
        Scalar::from_slice(&encoded[106..138]).map_err(|_| VssError::InvalidEncoding)?;
    let first_blinder =
        Scalar::from_slice(&encoded[138..170]).map_err(|_| VssError::InvalidEncoding)?;
    let second_blinder =
        Scalar::from_slice(&encoded[170..202]).map_err(|_| VssError::InvalidEncoding)?;
    Ok(ParsedShare {
        threshold,
        share_count,
        context_digest: context_digest_value,
        identifier,
        values: [first_value, second_value],
        blinders: [first_blinder, second_blinder],
    })
}

fn parse_commitments(encoded: &[u8], context: &[u8]) -> Result<CommitmentSet, VssError> {
    if encoded.len() < COMMITMENTS_FIXED_HEADER_BYTES
        || &encoded[..4] != COMMITMENTS_MAGIC
        || encoded[4] != WIRE_VERSION
        || encoded[5] != 0
    {
        return Err(VssError::InvalidLength);
    }
    let threshold = u16::from_be_bytes([encoded[6], encoded[7]]);
    let share_count = u16::from_be_bytes([encoded[8], encoded[9]]);
    if !(2..=MAX_SHARE_COUNT).contains(&threshold)
        || threshold > share_count
        || share_count > MAX_SHARE_COUNT
    {
        return Err(VssError::InvalidParameters);
    }
    let lane_bytes = 2 * GROUP_BYTES + 2 * 2 + threshold as usize * GROUP_BYTES * 2;
    let expected_len = COMMITMENTS_FIXED_HEADER_BYTES + 2 * lane_bytes;
    if encoded.len() != expected_len {
        return Err(VssError::InvalidLength);
    }
    let mut context_digest_value = [0u8; 32];
    context_digest_value.copy_from_slice(&encoded[10..42]);
    if context_digest_value != context_digest(context) {
        return Err(VssError::ContextMismatch);
    }
    if encoded[42] != 2 {
        return Err(VssError::InvalidEncoding);
    }
    let mut cursor = COMMITMENTS_FIXED_HEADER_BYTES;
    let first_lane = parse_commitment_lane(encoded, &mut cursor, threshold)?;
    let second_lane = parse_commitment_lane(encoded, &mut cursor, threshold)?;
    let lanes = [first_lane, second_lane];
    if cursor != encoded.len() {
        return Err(VssError::InvalidLength);
    }
    Ok(CommitmentSet {
        threshold,
        share_count,
        context_digest: context_digest_value,
        lanes,
    })
}

fn parse_commitment_lane(
    encoded: &[u8],
    cursor: &mut usize,
    threshold: u16,
) -> Result<CommitmentLane, VssError> {
    let secret_generator = parse_verifier_at(encoded, cursor)?;
    let blinder_generator = parse_verifier_at(encoded, cursor)?;
    if secret_generator.is_zero().into()
        || blinder_generator.is_zero().into()
        || secret_generator == blinder_generator
    {
        return Err(VssError::InvalidEncoding);
    }
    let feldman_count = read_u16(encoded, cursor)?;
    let pedersen_count = read_u16(encoded, cursor)?;
    if feldman_count != threshold || pedersen_count != threshold {
        return Err(VssError::InvalidEncoding);
    }
    let feldman_verifiers = parse_verifiers(encoded, cursor, threshold)?;
    let pedersen_verifiers = parse_verifiers(encoded, cursor, threshold)?;
    Ok(CommitmentLane {
        secret_generator,
        blinder_generator,
        feldman_verifiers,
        pedersen_verifiers,
    })
}

fn parse_verifier_at(encoded: &[u8], cursor: &mut usize) -> Result<Verifier, VssError> {
    let end = cursor
        .checked_add(GROUP_BYTES)
        .ok_or(VssError::InvalidLength)?;
    let verifier = Verifier::from_slice(encoded.get(*cursor..end).ok_or(VssError::InvalidLength)?)
        .map_err(|_| VssError::InvalidEncoding)?;
    *cursor = end;
    Ok(verifier)
}

fn read_u16(encoded: &[u8], cursor: &mut usize) -> Result<u16, VssError> {
    let end = cursor.checked_add(2).ok_or(VssError::InvalidLength)?;
    let bytes = encoded.get(*cursor..end).ok_or(VssError::InvalidLength)?;
    *cursor = end;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn parse_verifiers(
    encoded: &[u8],
    cursor: &mut usize,
    count: u16,
) -> Result<Vec<Verifier>, VssError> {
    let mut verifiers = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let end = cursor
            .checked_add(GROUP_BYTES)
            .ok_or(VssError::InvalidLength)?;
        let verifier =
            Verifier::from_slice(encoded.get(*cursor..end).ok_or(VssError::InvalidLength)?)
                .map_err(|_| VssError::InvalidEncoding)?;
        verifiers.push(verifier);
        *cursor = end;
    }
    Ok(verifiers)
}

fn validate_share_metadata(
    share: &ParsedShare,
    commitments: &CommitmentSet,
) -> Result<(), VssError> {
    if share.threshold != commitments.threshold
        || share.share_count != commitments.share_count
        || share.context_digest != commitments.context_digest
        || !valid_identifier(&share.identifier, commitments.share_count)
    {
        return Err(VssError::InvalidShare);
    }
    Ok(())
}

fn valid_identifier(identifier: &Scalar, share_count: u16) -> bool {
    (1..=share_count)
        .any(|expected| *identifier == Scalar::from(WrappedScalar::from(u64::from(expected))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_digest_is_domain_separated() {
        let plain_hash: [u8; 32] = Sha256::digest(b"death").into();
        assert_ne!(context_digest(b"death"), plain_hash);
    }
}
