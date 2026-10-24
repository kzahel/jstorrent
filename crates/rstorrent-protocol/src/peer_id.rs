//! Bounded client identification from conventional BitTorrent peer IDs.

use std::fmt::Write as _;
use std::str;

const MAX_CLIENT_NAME_BYTES: usize = 128;

// BEP 20's registry plus current mature and first-party identifiers. This is
// presentation vocabulary, not an authenticated statement about the peer.
const AZUREUS_CLIENT_NAMES: &[([u8; 2], &str)] = &[
    (*b"7T", "aTorrent for Android"),
    (*b"AB", "AnyEvent BitTorrent"),
    (*b"AG", "Ares"),
    (*b"AR", "Arctic Torrent"),
    (*b"AT", "Artemis"),
    (*b"AV", "Avicora"),
    (*b"AX", "BitPump"),
    (*b"AZ", "Azureus"),
    (*b"A~", "Ares"),
    (*b"BB", "BitBuddy"),
    (*b"BC", "BitComet"),
    (*b"BE", "baretorrent"),
    (*b"BF", "Bitflu"),
    (*b"BG", "BTG"),
    (*b"BI", "BiglyBT"),
    (*b"BL", "BitBlinder"),
    (*b"BP", "BitTorrent Pro"),
    (*b"BR", "BitRocket"),
    (*b"BS", "BTSlave"),
    (*b"BT", "BitTorrent"),
    (*b"BU", "BigUp"),
    (*b"BW", "BitWombat"),
    (*b"BX", "BitTorrent X"),
    (*b"CD", "Enhanced CTorrent"),
    (*b"CT", "CTorrent"),
    (*b"DE", "Deluge"),
    (*b"DP", "Propagate Data Client"),
    (*b"EB", "EBit"),
    (*b"ES", "Electric Sheep"),
    (*b"FC", "FileCroc"),
    (*b"FT", "FoxTorrent"),
    (*b"FW", "FrostWire"),
    (*b"FX", "Freebox BitTorrent"),
    (*b"GS", "GSTorrent"),
    (*b"HK", "Hekate"),
    (*b"HL", "Halite"),
    (*b"HN", "Hydranode"),
    (*b"IL", "iLivid"),
    (*b"JS", "JSTorrent"),
    (*b"KC", "Koinonein"),
    (*b"KG", "KGet"),
    (*b"KT", "KTorrent"),
    (*b"LC", "LeechCraft"),
    (*b"LH", "LH-ABC"),
    (*b"LK", "Linkage"),
    (*b"LP", "Lphant"),
    (*b"LR", "LibreTorrent"),
    (*b"LT", "libtorrent"),
    (*b"LW", "LimeWire"),
    (*b"ML", "MLDonkey"),
    (*b"MO", "MonoTorrent"),
    (*b"MP", "MooPolice"),
    (*b"MR", "Miro"),
    (*b"MT", "MoonlightTorrent"),
    (*b"NX", "Net Transport"),
    (*b"OS", "OneSwarm"),
    (*b"OT", "OmegaTorrent"),
    (*b"PD", "Pando"),
    (*b"QD", "QQDownload"),
    (*b"QT", "Qt Torrent"),
    (*b"RS", "JSTorrent"),
    (*b"RT", "Retriever"),
    (*b"RZ", "RezTorrent"),
    (*b"SB", "Swiftbit"),
    (*b"SD", "Xunlei"),
    (*b"SK", "Spark"),
    (*b"SN", "ShareNet"),
    (*b"SS", "SwarmScope"),
    (*b"ST", "SymTorrent"),
    (*b"SZ", "Shareaza"),
    (*b"S~", "Shareaza (beta)"),
    (*b"TB", "Torch"),
    (*b"TL", "Tribler"),
    (*b"TN", "Torrent.NET"),
    (*b"TR", "Transmission"),
    (*b"TS", "TorrentStorm"),
    (*b"TT", "TuoTu"),
    (*b"UL", "uLeecher"),
    (*b"UM", "µTorrent Mac"),
    (*b"UT", "µTorrent"),
    (*b"UW", "µTorrent Web"),
    (*b"VG", "Vagaa"),
    (*b"WD", "WebTorrent Desktop"),
    (*b"WT", "BitLet"),
    (*b"WW", "WebTorrent"),
    (*b"WY", "FireTorrent"),
    (*b"XF", "Xfplay"),
    (*b"XL", "Xunlei"),
    (*b"XS", "XSwifter"),
    (*b"XT", "XanTorrent"),
    (*b"XX", "Xtorrent"),
    (*b"ZO", "Zona"),
    (*b"ZT", "ZipTorrent"),
    (*b"lt", "rTorrent"),
    (*b"pX", "pHoeniX"),
    (*b"qB", "qBittorrent"),
    (*b"rQ", "rqbit"),
    (*b"st", "SharkTorrent"),
];

/// Identify a conventional client and version from a handshake peer ID.
///
/// Peer IDs are peer-controlled and spoofable. The returned value is a
/// bounded display hint and must not be used for trust or protocol policy.
pub fn identify_client(peer_id: &[u8; 20]) -> Option<String> {
    let identified = identify_nonstandard(peer_id)
        .or_else(|| identify_azureus(peer_id))
        .or_else(|| identify_shadow(peer_id))
        .or_else(|| identify_mainline(peer_id));
    if let Some(name) = &identified {
        debug_assert!(name.len() <= MAX_CLIENT_NAME_BYTES);
    }
    identified
}

fn identify_azureus(peer_id: &[u8; 20]) -> Option<String> {
    if peer_id[0] != b'-'
        || peer_id[7] != b'-'
        || !peer_id[1].is_ascii_graphic()
        || !peer_id[2].is_ascii_graphic()
    {
        return None;
    }

    let code: &[u8; 2] = peer_id[1..3].try_into().ok()?;
    let version = [
        decode_version_digit(peer_id[3])?,
        decode_version_digit(peer_id[4])?,
        decode_version_digit(peer_id[5])?,
        decode_version_digit(peer_id[6])?,
    ];
    let name = azureus_client_name(code).unwrap_or(str::from_utf8(code).ok()?);
    Some(format_version(name, version.map(u16::from)))
}

fn identify_shadow(peer_id: &[u8; 20]) -> Option<String> {
    let name = match peer_id[0] {
        b'A' => "ABC",
        b'O' => "Osprey Permaseed",
        b'Q' => "BTQueue",
        b'R' => "Tribler",
        b'S' => "Shadow",
        b'T' => "BitTornado",
        b'U' => "UPnP",
        _ => return None,
    };

    let version = if peer_id[4..6] == *b"--" {
        [
            u16::from(decode_version_digit(peer_id[1])?),
            u16::from(decode_version_digit(peer_id[2])?),
            u16::from(decode_version_digit(peer_id[3])?),
            0,
        ]
    } else {
        if peer_id[8] != 0 || peer_id[1..4].iter().any(|byte| *byte > 127) {
            return None;
        }
        [
            u16::from(peer_id[1]),
            u16::from(peer_id[2]),
            u16::from(peer_id[3]),
            0,
        ]
    };
    Some(format_version(name, version))
}

fn identify_mainline(peer_id: &[u8; 20]) -> Option<String> {
    if peer_id[0] != b'M' {
        return None;
    }

    let mut cursor = 1;
    let major = parse_decimal_component(peer_id, &mut cursor)?;
    let minor = parse_decimal_component(peer_id, &mut cursor)?;
    let revision = parse_decimal_component(peer_id, &mut cursor)?;
    if peer_id.get(cursor) != Some(&b'-') {
        return None;
    }
    Some(format_version("Mainline", [major, minor, revision, 0]))
}

fn identify_nonstandard(peer_id: &[u8; 20]) -> Option<String> {
    if &peer_id[..4] == b"exbc" || &peer_id[..4] == b"FUTB" {
        let name = if &peer_id[6..10] == b"LORD" {
            "BitLord"
        } else {
            "BitComet"
        };
        return Some(format!("{name} {}.{:02}", peer_id[4], peer_id[5]));
    }

    if &peer_id[..3] == b"XBT"
        && peer_id[3..6].iter().all(u8::is_ascii_digit)
        && matches!(peer_id[6], b'd' | b'-')
        && peer_id[7] == b'-'
    {
        return Some(format_version(
            "XBT",
            [
                u16::from(peer_id[3] - b'0'),
                u16::from(peer_id[4] - b'0'),
                u16::from(peer_id[5] - b'0'),
                0,
            ],
        ));
    }

    if &peer_id[..2] == b"OP" && peer_id[2..6].iter().all(u8::is_ascii_digit) {
        let build = peer_id[2..6]
            .iter()
            .fold(0_u16, |value, byte| value * 10 + u16::from(*byte - b'0'));
        return Some(format!("Opera {build}"));
    }

    if &peer_id[..3] == b"TIX" {
        return Some("Tixati".to_owned());
    }

    None
}

fn azureus_client_name(code: &[u8; 2]) -> Option<&'static str> {
    AZUREUS_CLIENT_NAMES
        .iter()
        .find_map(|(candidate, name)| (candidate == code).then_some(*name))
}

fn decode_version_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'A'..=b'Z' => Some(byte - b'A' + 10),
        b'a'..=b'z' => Some(byte - b'a' + 36),
        b'.' => Some(62),
        b'-' => Some(63),
        _ => None,
    }
}

fn parse_decimal_component(peer_id: &[u8; 20], cursor: &mut usize) -> Option<u16> {
    let start = *cursor;
    let mut value = 0_u16;
    while *cursor < peer_id.len() && peer_id[*cursor].is_ascii_digit() {
        if *cursor - start == 3 {
            return None;
        }
        value = value
            .checked_mul(10)?
            .checked_add(u16::from(peer_id[*cursor] - b'0'))?;
        *cursor += 1;
    }
    if *cursor == start || peer_id.get(*cursor) != Some(&b'-') {
        return None;
    }
    *cursor += 1;
    Some(value)
}

fn format_version(name: &str, version: [u16; 4]) -> String {
    let mut output = format!("{name} {}.{}.{}", version[0], version[1], version[2]);
    if version[3] != 0 {
        write!(output, ".{}", version[3]).expect("writing to a String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{AZUREUS_CLIENT_NAMES, MAX_CLIENT_NAME_BYTES, identify_client};

    fn peer_id(prefix: &[u8]) -> [u8; 20] {
        assert!(prefix.len() <= 20);
        let mut peer_id = [b'.'; 20];
        peer_id[..prefix.len()].copy_from_slice(prefix);
        peer_id
    }

    #[test]
    fn identifies_common_azureus_clients_and_base_64_versions() {
        for (prefix, expected) in [
            (b"-UT3550-".as_slice(), "µTorrent 3.5.5"),
            (b"-qB4500-".as_slice(), "qBittorrent 4.5.0"),
            (b"-TR3000-".as_slice(), "Transmission 3.0.0"),
            (b"-DE2000-".as_slice(), "Deluge 2.0.0"),
            (b"-LT20D0-".as_slice(), "libtorrent 2.0.13"),
            (b"-lt0D80-".as_slice(), "rTorrent 0.13.8"),
            (b"-UW1020-".as_slice(), "µTorrent Web 1.0.2"),
            (b"-WW0100-".as_slice(), "WebTorrent 0.1.0"),
            (b"-JS0100-".as_slice(), "JSTorrent 0.1.0"),
            (b"-RS0001-".as_slice(), "JSTorrent 0.0.0.1"),
            (b"-rQAFa.-".as_slice(), "rqbit 10.15.36.62"),
        ] {
            assert_eq!(identify_client(&peer_id(prefix)).as_deref(), Some(expected));
        }
    }

    #[test]
    fn preserves_a_sanitized_unknown_azureus_code() {
        assert_eq!(
            identify_client(&peer_id(b"-xx1230-")).as_deref(),
            Some("xx 1.2.3")
        );
    }

    #[test]
    fn identifies_shadow_and_mainline_styles() {
        assert_eq!(
            identify_client(&peer_id(b"S58B--")).as_deref(),
            Some("Shadow 5.8.11")
        );
        let mut binary_shadow = peer_id(b"S\x01\x02\x03");
        binary_shadow[8] = 0;
        assert_eq!(
            identify_client(&binary_shadow).as_deref(),
            Some("Shadow 1.2.3")
        );
        assert_eq!(
            identify_client(&peer_id(b"M4-20-8--")).as_deref(),
            Some("Mainline 4.20.8")
        );
    }

    #[test]
    fn identifies_bep_20_nonstandard_styles() {
        let mut bitcomet = peer_id(b"exbc");
        bitcomet[4] = 1;
        bitcomet[5] = 2;
        assert_eq!(identify_client(&bitcomet).as_deref(), Some("BitComet 1.02"));

        let mut bitlord = bitcomet;
        bitlord[6..10].copy_from_slice(b"LORD");
        assert_eq!(identify_client(&bitlord).as_deref(), Some("BitLord 1.02"));
        assert_eq!(
            identify_client(&peer_id(b"XBT054d-")).as_deref(),
            Some("XBT 0.5.4")
        );
        assert_eq!(
            identify_client(&peer_id(b"OP0034")).as_deref(),
            Some("Opera 34")
        );
        assert_eq!(identify_client(&peer_id(b"TIX")).as_deref(), Some("Tixati"));
    }

    #[test]
    fn rejects_malformed_and_ambiguous_ids() {
        for malformed in [
            [0; 20],
            peer_id(b"random-peer-id"),
            peer_id(b"-UT12/0-"),
            peer_id(b"-UT1234."),
            peer_id(b"M1-2-3-"),
            peer_id(b"M1234-2-3--"),
            peer_id(b"S12/--"),
        ] {
            assert_eq!(identify_client(&malformed), None);
        }

        let mut control_code = peer_id(b"-UT1230-");
        control_code[1] = 0;
        assert_eq!(identify_client(&control_code), None);
    }

    #[test]
    fn every_registered_name_stays_within_the_application_bound() {
        for (code, _) in AZUREUS_CLIENT_NAMES {
            let mut id = peer_id(b"-xxzzzz-");
            id[1..3].copy_from_slice(code);
            let name = identify_client(&id).expect("registered code");
            assert!(name.len() <= MAX_CLIENT_NAME_BYTES, "{name}");
        }
    }
}
