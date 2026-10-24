//! Packed file-index sets. The catalog owns torrent identity and metadata;
//! this codec owns bounds, bit order and a single canonical byte encoding.

use rstorrent_protocol::metainfo::MAX_METAINFO_FILES;

pub(crate) const MAX_FILE_BITMAP_BYTES: usize = MAX_METAINFO_FILES.div_ceil(8);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct FileBitmap(Vec<u8>);

impl FileBitmap {
    pub(crate) fn decode(bytes: Vec<u8>) -> Result<Self, &'static str> {
        if bytes.len() > MAX_FILE_BITMAP_BYTES {
            return Err("file bitmap exceeds the file-count bound");
        }
        if bytes.last() == Some(&0) {
            return Err("file bitmap has noncanonical trailing zero bytes");
        }
        if bytes.len() == MAX_FILE_BITMAP_BYTES
            && bytes.last().is_some_and(|byte| byte & 0b1100_0000 != 0)
        {
            return Err("file bitmap contains out-of-range bits");
        }
        Ok(Self(bytes))
    }

    pub(crate) fn from_indices(indices: &[u32]) -> Result<Self, &'static str> {
        let mut bitmap = Self::default();
        for &index in indices {
            bitmap.set(index, true)?;
        }
        Ok(bitmap)
    }

    pub(crate) fn set(&mut self, index: u32, value: bool) -> Result<(), &'static str> {
        let index = index as usize;
        if index >= MAX_METAINFO_FILES {
            return Err("file bitmap index exceeds the file-count bound");
        }
        let byte = index / 8;
        if value {
            self.0.resize(self.0.len().max(byte + 1), 0);
            self.0[byte] |= 1 << (index % 8);
        } else if let Some(byte) = self.0.get_mut(byte) {
            *byte &= !(1 << (index % 8));
            while self.0.last() == Some(&0) {
                self.0.pop();
            }
        }
        Ok(())
    }

    pub(crate) fn contains(&self, index: u32) -> bool {
        self.0
            .get(index as usize / 8)
            .is_some_and(|byte| byte & (1 << (index % 8)) != 0)
    }

    pub(crate) fn include_unallowed(&mut self, matched: &Self, allowed: &Self) {
        self.0.resize(self.0.len().max(matched.0.len()), 0);
        for (index, byte) in matched.0.iter().enumerate() {
            self.0[index] |= byte & !allowed.0.get(index).copied().unwrap_or(0);
        }
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
    }

    pub(crate) fn indices(&self) -> Vec<u32> {
        self.0
            .iter()
            .enumerate()
            .flat_map(|(index, byte)| {
                (0..8).filter_map(move |bit| {
                    (byte & (1 << bit) != 0).then_some((index * 8 + bit) as u32)
                })
            })
            .collect()
    }

    pub(crate) fn last_index(&self) -> Option<u32> {
        self.0
            .last()
            .map(|byte| ((self.0.len() - 1) * 8 + (7 - byte.leading_zeros() as usize)) as u32)
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maximum_fragmentation_is_bounded_and_round_trips() {
        let indices = (0..MAX_METAINFO_FILES as u32)
            .step_by(2)
            .collect::<Vec<_>>();
        let bitmap = FileBitmap::from_indices(&indices).unwrap();
        assert_eq!(bitmap.bytes().len(), MAX_FILE_BITMAP_BYTES);
        assert_eq!(FileBitmap::decode(bitmap.0).unwrap().indices(), indices);
        assert!(FileBitmap::from_indices(&[MAX_METAINFO_FILES as u32]).is_err());
    }

    #[test]
    fn canonical_empty_and_invalid_encodings() {
        let mut bitmap = FileBitmap::from_indices(&[0, 8, 374_997]).unwrap();
        assert!(bitmap.contains(374_997));
        for index in [374_997, 8, 0] {
            bitmap.set(index, false).unwrap();
        }
        assert!(bitmap.bytes().is_empty());
        assert!(FileBitmap::decode(vec![0]).is_err());
        assert!(FileBitmap::decode(vec![1; MAX_FILE_BITMAP_BYTES + 1]).is_err());
        let mut invalid = vec![0; MAX_FILE_BITMAP_BYTES];
        invalid[MAX_FILE_BITMAP_BYTES - 1] = 0x80;
        assert!(FileBitmap::decode(invalid).is_err());
    }
}
