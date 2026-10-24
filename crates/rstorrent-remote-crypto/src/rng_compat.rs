use core::convert::Infallible;

use p256::elliptic_curve::rand_core::{TryCryptoRng, TryRng};
use rand::{CryptoRng, RngCore};

/// Bridge the existing entropy sources to P-256's newer rand_core traits.
///
/// OPAQUE still requires the older traits. Delegation preserves the source
/// byte stream and its existing failure behavior without changing either
/// protocol's entropy provider or marking non-cryptographic sources secure.
pub struct RngCompat<R>(R);

impl<R> RngCompat<R> {
    pub fn new(rng: R) -> Self {
        Self(rng)
    }
}

impl<R: RngCore> TryRng for RngCompat<R> {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        Ok(self.0.next_u32())
    }

    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        Ok(self.0.next_u64())
    }

    fn try_fill_bytes(&mut self, destination: &mut [u8]) -> Result<(), Self::Error> {
        self.0.fill_bytes(destination);
        Ok(())
    }
}

impl<R: RngCore + CryptoRng> TryCryptoRng for RngCompat<R> {}

#[cfg(test)]
mod tests {
    use p256::elliptic_curve::rand_core::Rng;
    use rand::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    use super::*;

    #[test]
    fn mixed_requests_preserve_the_existing_entropy_stream() {
        let mut original = ChaCha20Rng::from_seed([42; 32]);
        let mut adapted = RngCompat::new(ChaCha20Rng::from_seed([42; 32]));
        for length in [0, 1, 7, 32, 64, 3] {
            assert_eq!(original.next_u32(), adapted.next_u32());
            assert_eq!(original.next_u64(), adapted.next_u64());
            let mut expected = vec![0; length];
            let mut actual = vec![0; length];
            original.fill_bytes(&mut expected);
            adapted.fill_bytes(&mut actual);
            assert_eq!(actual, expected);
        }
    }
}
