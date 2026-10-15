use std::sync::LazyLock;

use regex::{Captures, Regex};

mod library;

pub use library::{
    LibraryFile, LibraryRole, MediaKind, TrackClassification, album_group_key, classify_library,
    series_group_key,
};

pub const CLASSIFIER_VERSION: u16 = 1;

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mkv", "avi", "webm", "mov", "m4v", "ts", "mts", "m2ts", "flv", "wmv", "ogv", "3gp",
];

static NAMED_EPISODE_PATTERNS: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        Regex::new(
            r"(?i)^(?P<series>.+?)[\s._-]+s(?P<season>\d{1,2})[\s._-]*e(?P<episode>\d{1,3})",
        )
        .expect("fixed named S/E episode pattern"),
        Regex::new(r"(?i)^(?P<series>.+?)[\s._-]+(?P<season>\d{1,2})x(?P<episode>\d{1,3})")
            .expect("fixed named x-style episode pattern"),
    ]
});

static BARE_EPISODE_PATTERNS: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        Regex::new(r"(?i)(?:^|[\s._-])s(?P<season>\d{1,2})[\s._-]*e(?P<episode>\d{1,3})")
            .expect("fixed bare S/E episode pattern"),
        Regex::new(r"(?i)(?:^|[\s._-])(?P<season>\d{1,2})x(?P<episode>\d{1,3})")
            .expect("fixed bare x-style episode pattern"),
    ]
});

static ENDING_EPISODE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:[\s._-]*(?:ep|e)(?P<prefixed>\d{1,3})|[\s._]*-(?P<bare>\d{1,3}))(?:\D|$)")
        .expect("fixed ending episode pattern")
});

static SEASON_FOLDER_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:(?:season|series)[\s._-]*\d{1,2}|s\d{1,2}|specials?)$")
        .expect("fixed season folder pattern")
});

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MediaClassification {
    Episode(EpisodeClassification),
    UnclassifiedVideo,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpisodeClassification {
    pub series_title_hint: String,
    pub season_number: u16,
    pub episode_number: u16,
    pub ending_episode_number: Option<u16>,
}

pub fn classify_video(path_components: &[String]) -> Option<MediaClassification> {
    let filename = path_components.last()?;
    let (stem, extension) = split_extension(filename)?;
    if !VIDEO_EXTENSIONS.contains(&extension) {
        return None;
    }
    Some(match episode_parts(stem, path_components) {
        Some((episode, _)) => MediaClassification::Episode(episode),
        None => MediaClassification::UnclassifiedVideo,
    })
}

/// The episode a video stem names, and the stem text after its episode code.
fn episode_parts<'stem>(
    stem: &'stem str,
    path_components: &[String],
) -> Option<(EpisodeClassification, &'stem str)> {
    for pattern in NAMED_EPISODE_PATTERNS.iter() {
        if let Some(captures) = pattern.captures(stem)
            && let Some(parts) = episode_from_captures(stem, &captures, path_components, true)
        {
            return Some(parts);
        }
    }
    for pattern in BARE_EPISODE_PATTERNS.iter() {
        if let Some(captures) = pattern.captures(stem)
            && let Some(parts) = episode_from_captures(stem, &captures, path_components, false)
        {
            return Some(parts);
        }
    }
    None
}

pub fn video_extension(filename: &str) -> Option<&str> {
    let (_, extension) = split_extension(filename)?;
    VIDEO_EXTENSIONS.contains(&extension).then_some(extension)
}

fn split_extension(filename: &str) -> Option<(&str, &str)> {
    let dot = filename.rfind('.')?;
    let extension = filename.get(dot + 1..)?;
    if extension.is_empty() {
        return None;
    }
    let canonical = VIDEO_EXTENSIONS
        .iter()
        .copied()
        .find(|candidate| extension.eq_ignore_ascii_case(candidate))?;
    Some((&filename[..dot], canonical))
}

fn episode_from_captures<'stem>(
    stem: &'stem str,
    captures: &Captures<'_>,
    path_components: &[String],
    named: bool,
) -> Option<(EpisodeClassification, &'stem str)> {
    let complete_match = captures.get(0)?;
    let remainder = stem.get(complete_match.end()..)?;
    if remainder
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_digit())
    {
        return None;
    }

    let season_number = capture_number(captures, "season")?;
    let episode_number = capture_number(captures, "episode")?;
    let series_title_hint = if named {
        captures
            .name("series")
            .map(|value| clean_title(value.as_str()))
            .filter(|value| !value.is_empty())
            .or_else(|| parent_title(path_components))?
    } else {
        parent_title(path_components)?
    };
    let ending = ending_episode(remainder).filter(|(ending, _)| *ending >= episode_number);
    let after_code = ending.map_or(remainder, |(_, end)| &remainder[end..]);

    Some((
        EpisodeClassification {
            series_title_hint,
            season_number,
            episode_number,
            ending_episode_number: ending.map(|(ending, _)| ending),
        },
        after_code,
    ))
}

fn capture_number(captures: &Captures<'_>, name: &str) -> Option<u16> {
    captures.name(name)?.as_str().parse().ok()
}

/// The ending episode number and the byte offset just past it.
fn ending_episode(remainder: &str) -> Option<(u16, usize)> {
    let captures = ENDING_EPISODE_PATTERN.captures(remainder)?;
    if let Some(prefixed) = captures.name("prefixed") {
        return Some((prefixed.as_str().parse().ok()?, prefixed.end()));
    }
    let bare = captures.name("bare")?;
    if remainder
        .get(bare.end()..)
        .is_some_and(|tail| tail.starts_with(['p', 'P']))
    {
        return None;
    }
    Some((bare.as_str().parse().ok()?, bare.end()))
}

fn parent_title(path_components: &[String]) -> Option<String> {
    path_components.iter().rev().skip(1).find_map(|component| {
        let trimmed = component.trim();
        if SEASON_FOLDER_PATTERN.is_match(trimmed) {
            return None;
        }
        let candidate = clean_title(trimmed);
        (!candidate.is_empty() && !candidate.chars().all(|character| character.is_numeric()))
            .then_some(candidate)
    })
}

fn clean_title(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut pending_space = false;
    for character in value.chars() {
        let separator = character.is_whitespace()
            || matches!(character, '.' | '_' | '[' | ']' | '(' | ')' | '{' | '}');
        if separator {
            pending_space = !result.is_empty();
            continue;
        }
        if pending_space && !matches!(character, '-') {
            result.push(' ');
        }
        pending_space = false;
        result.push(character);
    }
    result.trim_matches([' ', '-']).trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        CLASSIFIER_VERSION, EpisodeClassification, MediaClassification, classify_video,
        video_extension,
    };

    fn classify(path: &str) -> Option<MediaClassification> {
        classify_video(&path.split('/').map(ToOwned::to_owned).collect::<Vec<_>>())
    }

    fn episode(path: &str) -> EpisodeClassification {
        let Some(MediaClassification::Episode(episode)) = classify(path) else {
            panic!("expected episode classification for {path}");
        };
        episode
    }

    #[test]
    fn classifier_version_is_explicit() {
        assert_eq!(CLASSIFIER_VERSION, 1);
    }

    #[test]
    fn extension_gate_is_case_insensitive_and_final() {
        for extension in [
            "mp4", "mkv", "avi", "webm", "mov", "m4v", "ts", "mts", "m2ts", "flv", "wmv", "ogv",
            "3gp",
        ] {
            assert_eq!(
                classify(&format!("clip.{extension}")),
                Some(MediaClassification::UnclassifiedVideo)
            );
            assert_eq!(
                video_extension(&format!("clip.{}", extension.to_uppercase())),
                Some(extension)
            );
        }
        assert_eq!(classify("clip.mkv.nfo"), None);
        assert_eq!(classify("clip"), None);
        assert_eq!(classify("clip."), None);
        assert_eq!(
            classify(".MKV"),
            Some(MediaClassification::UnclassifiedVideo)
        );
    }

    #[test]
    fn parses_named_episode_forms_and_cleans_titles() {
        assert_eq!(
            episode("Sample.Show_[US]-S01E007.1080p.mkv"),
            EpisodeClassification {
                series_title_hint: "Sample Show US".to_owned(),
                season_number: 1,
                episode_number: 7,
                ending_episode_number: None,
            }
        );
        assert_eq!(
            episode("Andor 1x02.mkv"),
            EpisodeClassification {
                series_title_hint: "Andor".to_owned(),
                season_number: 1,
                episode_number: 2,
                ending_episode_number: None,
            }
        );
        assert_eq!(episode("24 S00E01.mkv").series_title_hint, "24");
        assert_eq!(
            episode("東京.Show.S02E03.mkv").series_title_hint,
            "東京 Show"
        );
    }

    #[test]
    fn parses_supported_multi_episode_endings_without_consuming_resolution() {
        for path in [
            "Show.S01E07-E08.mkv",
            "Show.S01E07-08.mkv",
            "Show.S01E07E08.mkv",
            "Show.S01E07_EP08.mkv",
            "Show.1x07-08.mkv",
        ] {
            assert_eq!(episode(path).ending_episode_number, Some(8), "{path}");
        }
        assert_eq!(episode("Show.S01E07-720p.mkv").ending_episode_number, None);
        assert_eq!(episode("Show.S01E07.720p.mkv").ending_episode_number, None);
        assert_eq!(episode("Show.S01E07-E06.mkv").ending_episode_number, None);
    }

    #[test]
    fn bare_episode_uses_nearest_meaningful_parent() {
        assert_eq!(
            episode("Sample_Show/Season 01/S01E07.mkv").series_title_hint,
            "Sample Show"
        );
        assert_eq!(
            episode("Sample Show/Specials/S00E02.mkv").series_title_hint,
            "Sample Show"
        );
        assert_eq!(
            episode("Outer/Inner Series/Series 2/2x010.mkv").series_title_hint,
            "Inner Series"
        );
        assert_eq!(
            classify("Season 01/S01E07.mkv"),
            Some(MediaClassification::UnclassifiedVideo)
        );
    }

    #[test]
    fn malformed_or_out_of_shape_codes_remain_unclassified_video() {
        for path in [
            "Show.S001E02.mkv",
            "Show.S01E0002.mkv",
            "Show.S1E.mkv",
            "Show.SxE2.mkv",
            "S01E02.mkv",
        ] {
            assert_eq!(
                classify(path),
                Some(MediaClassification::UnclassifiedVideo),
                "{path}"
            );
        }
    }

    #[test]
    fn classifier_handles_the_maximum_file_count_in_one_linear_pass() {
        let paths = (0..4_096)
            .map(|index| vec![format!("Scale.Show.S01E{index:03}.mkv")])
            .collect::<Vec<_>>();
        let classified = paths.iter().filter_map(|path| classify_video(path)).count();
        assert_eq!(classified, 4_096);
    }
}
