use dls_vss::{VssError, combine_pedersen, split_pedersen, verify_pedersen_share};

#[cfg(feature = "test-vectors")]
use dls_vss::split_pedersen_test_vector;

fn secret(seed: u8) -> Vec<u8> {
    (0..32).map(|offset| seed.wrapping_add(offset)).collect()
}

fn context(purpose: &[u8]) -> Vec<u8> {
    let mut value = b"vault-01/generation-02/".to_vec();
    value.extend_from_slice(purpose);
    value
}

fn select(shares: &[Vec<u8>], indexes: &[usize]) -> Vec<Vec<u8>> {
    indexes.iter().map(|index| shares[*index].clone()).collect()
}

fn expect_error(result: Result<Vec<u8>, VssError>) {
    assert!(
        result.is_err(),
        "expected an invalid VSS input to be rejected"
    );
}

#[test]
fn reconstructs_every_combination_for_two_of_three() {
    let original = secret(7);
    let split =
        split_pedersen(&original, 2, 3, &context(b"death")).expect("2-of-3 split should succeed");

    for indexes in [[0, 1], [0, 2], [1, 2]] {
        let recovered = combine_pedersen(
            &select(&split.shares, &indexes),
            &split.commitments,
            &context(b"death"),
        )
        .expect("valid share combination should reconstruct");
        assert_eq!(recovered, original);
    }
}

#[test]
fn reconstructs_every_combination_for_three_of_five() {
    let original = secret(19);
    let split = split_pedersen(&original, 3, 5, &context(b"recovery"))
        .expect("3-of-5 split should succeed");

    for indexes in [
        [0, 1, 2],
        [0, 1, 3],
        [0, 1, 4],
        [0, 2, 3],
        [0, 2, 4],
        [0, 3, 4],
        [1, 2, 3],
        [1, 2, 4],
        [1, 3, 4],
        [2, 3, 4],
    ] {
        let recovered = combine_pedersen(
            &select(&split.shares, &indexes),
            &split.commitments,
            &context(b"recovery"),
        )
        .expect("valid share combination should reconstruct");
        assert_eq!(recovered, original);
    }
}

#[test]
fn supports_the_configured_maximum_share_count() {
    let original = secret(33);
    let split = split_pedersen(&original, 5, 32, &context(b"death-max"))
        .expect("maximum configured share count should succeed");

    for indexes in [
        [0, 1, 2, 3, 4],
        [0, 5, 10, 15, 20],
        [7, 14, 21, 28, 31],
        [2, 9, 18, 25, 30],
    ] {
        let recovered = combine_pedersen(
            &select(&split.shares, &indexes),
            &split.commitments,
            &context(b"death-max"),
        )
        .expect("valid maximum-count combination should reconstruct");
        assert_eq!(recovered, original);
    }
}

#[test]
fn rejects_too_few_duplicate_zero_and_out_of_range_shares() {
    let split = split_pedersen(&secret(41), 3, 5, &context(b"negative"))
        .expect("fixture split should succeed");

    expect_error(combine_pedersen(
        &select(&split.shares, &[0, 1]),
        &split.commitments,
        &context(b"negative"),
    ));
    expect_error(combine_pedersen(
        &select(&split.shares, &[0, 0, 1]),
        &split.commitments,
        &context(b"negative"),
    ));

    let mut zero_id = split.shares[0].clone();
    zero_id[42..74].fill(0);
    expect_error(combine_pedersen(
        &select(
            &[zero_id, split.shares[1].clone(), split.shares[2].clone()],
            &[0, 1, 2],
        ),
        &split.commitments,
        &context(b"negative"),
    ));

    let mut out_of_range = split.shares[0].clone();
    out_of_range[42..74].fill(0);
    out_of_range[42] = 6;
    expect_error(combine_pedersen(
        &select(
            &[
                out_of_range,
                split.shares[1].clone(),
                split.shares[2].clone(),
            ],
            &[0, 1, 2],
        ),
        &split.commitments,
        &context(b"negative"),
    ));
}

#[test]
fn rejects_mixed_contexts_wrong_purpose_and_corruption() {
    let original = secret(55);
    let split =
        split_pedersen(&original, 2, 3, &context(b"death")).expect("fixture split should succeed");

    assert!(!verify_pedersen_share(
        &split.shares[0],
        &split.commitments,
        &context(b"recovery"),
    ));
    expect_error(combine_pedersen(
        &select(&split.shares, &[0, 1]),
        &split.commitments,
        &context(b"recovery"),
    ));

    let mut corrupted_share = split.shares[0].clone();
    let corrupted_share_last = corrupted_share.len() - 1;
    corrupted_share[corrupted_share_last] ^= 0x80;
    assert!(!verify_pedersen_share(
        &corrupted_share,
        &split.commitments,
        &context(b"death"),
    ));

    let mut corrupted_commitments = split.commitments.clone();
    let corrupted_commitments_last = corrupted_commitments.len() - 1;
    corrupted_commitments[corrupted_commitments_last] ^= 0x01;
    assert!(!verify_pedersen_share(
        &split.shares[0],
        &corrupted_commitments,
        &context(b"death"),
    ));
}

#[test]
fn rejects_invalid_parameters_and_malformed_buffers() {
    let original = secret(73);
    for (threshold, share_count) in [(0, 3), (1, 3), (4, 3), (2, 1), (2, 33)] {
        assert!(split_pedersen(&original, threshold, share_count, &context(b"params")).is_err());
    }
    assert!(split_pedersen(&[0u8; 31], 2, 3, &context(b"params")).is_err());
    assert!(split_pedersen(&original, 2, 3, &[]).is_err());

    let split =
        split_pedersen(&original, 2, 3, &context(b"params")).expect("fixture split should succeed");
    assert!(!verify_pedersen_share(
        &split.shares[0][..split.shares[0].len() - 1],
        &split.commitments,
        &context(b"params"),
    ));
    expect_error(combine_pedersen(
        &[split.shares[0].clone(), vec![0u8; 1]],
        &split.commitments,
        &context(b"params"),
    ));
}

#[cfg(feature = "test-vectors")]
#[test]
fn prints_the_committed_non_secret_vector_digests() {
    use sha2::{Digest, Sha256};

    let secret = secret(91);
    let context = context(b"vector");
    let split = split_pedersen_test_vector(&secret, 2, 3, &context)
        .expect("deterministic vector split should succeed");
    let hash = |bytes: &[u8]| -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    };
    println!(
        "VECTOR secret={} context={} commitments={} shares={:?}",
        hash(&secret),
        hash(&context),
        hash(&split.commitments),
        split
            .shares
            .iter()
            .map(|share| hash(share))
            .collect::<Vec<_>>()
    );
}
