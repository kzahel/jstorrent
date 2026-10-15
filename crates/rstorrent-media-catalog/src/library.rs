//! Library classification of a torrent's video and audio files.
//!
//! Classification reads only metainfo paths. It decides the media kind from
//! the file extension, derives a display title, and extracts conservative
//! episode, movie and album hints plus the keys that group files across
//! torrents. Samples are not Library files.

use std::sync::LazyLock;

use regex::Regex;

use super::{
    EpisodeClassification, SEASON_FOLDER_PATTERN, VIDEO_EXTENSIONS, clean_title, episode_parts,
};

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "m4a", "m4b", "aac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif", "ape",
    "wv", "mka", "alac", "dsf",
];

/// Release and encoding tags that end a title in a video name.
const RELEASE_TAGS: &[&str] = &[
    "2160p", "1440p", "1080p", "1080i", "720p", "576p", "480p", "4k", "uhd", "hdr", "hdr10", "dv",
    "x264", "x265", "h264", "h265", "hevc", "avc", "xvid", "divx", "bluray", "bdrip", "brrip",
    "webrip", "webdl", "web-dl", "web", "hdtv", "dvdrip", "dvd", "remux", "proper", "repack",
    "internal", "10bit", "8bit", "aac", "ac3", "dts", "ddp5", "multi",
];

/// Format and source tags that do not distinguish one album from another.
const ALBUM_TAGS: &[&str] = &[
    "flac", "mp3", "320", "320kbps", "256", "v0", "v2", "24bit", "16bit", "lossless", "aac", "ogg",
    "alac", "web", "cd", "vinyl", "hi-res", "hires",
];

static DISC_FOLDER_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:cd|disc|disk)[\s._-]*(?P<disc>\d{1,2})$").expect("fixed disc folder")
});

static TRACK_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:(?P<disc>\d)[-.](?P<track>\d{1,3})|(?P<only>\d{1,3}))(?:[\s._]*-[\s._]*|[\s._]+)(?P<title>.+)$",
    )
    .expect("fixed track pattern")
});

static BRACKETED_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[^\]]*\]|\{[^}]*\}").expect("fixed bracket pattern"));

static PARENTHESIZED_YEAR_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\(\s*(?P<year>(?:19|20)\d{2})\s*\)").expect("fixed parenthesized year")
});

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub enum MediaKind {
    Video,
    Audio,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrackClassification {
    pub album_title_hint: Option<String>,
    pub disc_number: Option<u16>,
    pub track_number: Option<u16>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LibraryRole {
    Episode(EpisodeClassification),
    Movie,
    Other,
    Track(TrackClassification),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LibraryFile {
    pub file_index: usize,
    pub kind: MediaKind,
    /// Lowercase canonical extension.
    pub extension: &'static str,
    /// Non-empty display title.
    pub title: String,
    pub year: Option<u16>,
    pub role: LibraryRole,
}

/// Classifies one torrent's files for the Library.
///
/// `files` are the torrent's non-padding files as `(file index, path)`, and
/// `root` is the folder a multi-file torrent's paths are relative to.
/// Whether a non-episode video is a movie depends on the other videos in the
/// same torrent: it is when it names a year, or is the only one in a torrent
/// without episodes.
pub fn classify_library<'path>(
    files: impl IntoIterator<Item = (usize, &'path [String])>,
    root: Option<&str>,
) -> Vec<LibraryFile> {
    let mut output = Vec::new();
    let mut loose_videos = Vec::new();
    for (file_index, relative) in files {
        // A multi-file torrent's paths start below its own folder, which
        // still names the show, album or movie.
        let rooted;
        let path = match root {
            Some(root) => {
                rooted = std::iter::once(root.to_owned())
                    .chain(relative.iter().cloned())
                    .collect::<Vec<_>>();
                rooted.as_slice()
            }
            None => relative,
        };
        let Some(filename) = path.last() else {
            continue;
        };
        let Some((stem, extension)) = split_media_extension(filename) else {
            continue;
        };
        let fallback = fallback_title(stem, filename);
        let kind = if VIDEO_EXTENSIONS.contains(&extension) {
            MediaKind::Video
        } else {
            MediaKind::Audio
        };
        match kind {
            MediaKind::Video => {
                if let Some((episode, after_code)) = episode_parts(stem, path) {
                    // The episode's own name, else the release name up to
                    // its first tag, as in `Show S01E01` for
                    // `Show.S01E01.1080p.WEB-DL.mkv`.
                    let title = title_before_tags(after_code)
                        .or_else(|| title_before_tags(stem))
                        .map_or(fallback, |(title, _)| title);
                    output.push(LibraryFile {
                        file_index,
                        kind,
                        extension,
                        title,
                        year: None,
                        role: LibraryRole::Episode(episode),
                    });
                    continue;
                }
                if is_sample(stem, path) {
                    continue;
                }
                let (title, year) = movie_title(stem, path, fallback);
                loose_videos.push(output.len());
                output.push(LibraryFile {
                    file_index,
                    kind,
                    extension,
                    title,
                    year,
                    role: LibraryRole::Other,
                });
            }
            MediaKind::Audio => {
                let (disc_folder, album) = album_folder(path);
                let (disc, track, title) = track_parts(stem, fallback);
                let year = album
                    .as_ref()
                    .and_then(|(_, year)| *year)
                    .or_else(|| year_in(stem));
                output.push(LibraryFile {
                    file_index,
                    kind,
                    extension,
                    title,
                    year,
                    role: LibraryRole::Track(TrackClassification {
                        album_title_hint: album.map(|(title, _)| title),
                        disc_number: disc.or(disc_folder),
                        track_number: track,
                    }),
                });
            }
        }
    }
    // A lone extra beside a season's episodes is not a movie.
    let has_episodes = output
        .iter()
        .any(|file| matches!(file.role, LibraryRole::Episode(_)));
    let single = loose_videos.len() == 1 && !has_episodes;
    for position in loose_videos {
        let file = &mut output[position];
        if single || file.year.is_some() {
            file.role = LibraryRole::Movie;
        }
    }
    output
}

/// The key that groups episodes of one series across torrents.
pub fn series_group_key(series_title: &str) -> String {
    let mut words = normalized_words(series_title);
    // Trailing years, season labels and pack words name a release, not the
    // show: `Show (2019) Season 1 Complete` groups with `Show`.
    loop {
        let before = words.len();
        if words.len() > 1
            && words
                .last()
                .is_some_and(|word| is_year(word) || word == "complete")
        {
            words.pop();
        }
        if words.len() > 2
            && matches!(words[words.len() - 2].as_str(), "season" | "series")
            && words
                .last()
                .is_some_and(|word| word.bytes().all(|byte| byte.is_ascii_digit()))
        {
            words.truncate(words.len() - 2);
        }
        if words.len() > 1
            && words.last().is_some_and(|word| {
                word.len() <= 3
                    && word.starts_with('s')
                    && word.len() > 1
                    && word[1..].bytes().all(|byte| byte.is_ascii_digit())
            })
        {
            words.pop();
        }
        if words.len() == before {
            return words.join(" ");
        }
    }
}

/// The key that groups tracks of one album across torrents.
pub fn album_group_key(album_title: &str) -> String {
    let without_tags = BRACKETED_PATTERN.replace_all(album_title, " ");
    normalized_words(&without_tags)
        .into_iter()
        .filter(|word| !is_year(word) && !ALBUM_TAGS.contains(&word.as_str()))
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_media_extension(filename: &str) -> Option<(&str, &'static str)> {
    let dot = filename.rfind('.')?;
    let extension = filename.get(dot + 1..)?;
    let canonical = VIDEO_EXTENSIONS
        .iter()
        .chain(AUDIO_EXTENSIONS)
        .copied()
        .find(|candidate| extension.eq_ignore_ascii_case(candidate))?;
    Some((&filename[..dot], canonical))
}

/// A `Sample` folder, a bare `sample`, or a name ending in `sample` marks
/// release sample clips. Episode-coded files are never samples.
fn is_sample(stem: &str, path: &[String]) -> bool {
    let folder_sample = path[..path.len() - 1].iter().any(|component| {
        let component = component.trim();
        component.eq_ignore_ascii_case("sample") || component.eq_ignore_ascii_case("samples")
    });
    let lower = stem.to_lowercase();
    folder_sample
        || lower == "sample"
        || lower.starts_with("sample-")
        || ["-sample", ".sample", "_sample", " sample"]
            .iter()
            .any(|suffix| lower.ends_with(suffix))
}

fn movie_title(stem: &str, path: &[String], fallback: String) -> (String, Option<u16>) {
    let own = title_before_tags(stem);
    if let Some((title, Some(year))) = own {
        return (title, Some(year));
    }
    // A generic file name inside a dated release folder takes the folder's
    // title, as in `Movie (2019)/movie.mkv`.
    if path.len() > 1
        && let Some((title, Some(year))) = title_before_tags(&path[path.len() - 2])
    {
        return (title, Some(year));
    }
    (own.map_or(fallback, |(title, _)| title), None)
}

/// The words of a release name before its first year or release tag, and
/// that year. A leading year is part of the title, as in `2012`.
fn title_before_tags(name: &str) -> Option<(String, Option<u16>)> {
    let words = name
        .split(|character: char| {
            character.is_whitespace()
                || matches!(character, '.' | '_' | '[' | ']' | '(' | ')' | '{' | '}')
        })
        .filter(|word| !word.is_empty() && !word.chars().all(|character| character == '-'))
        .collect::<Vec<_>>();
    let mut title = Vec::new();
    let mut year = None;
    for (position, word) in words.iter().enumerate() {
        let lower = word.to_lowercase();
        if position > 0 && is_year(&lower) {
            year = lower.parse().ok();
            break;
        }
        if RELEASE_TAGS.contains(&lower.trim_matches('-')) {
            break;
        }
        title.push(*word);
    }
    let title = clean_title(&title.join(" "));
    (!title.is_empty()).then_some((title, year))
}

/// The cleaned stem, or the whole file name when nothing of the stem remains.
fn fallback_title(stem: &str, filename: &str) -> String {
    let cleaned = clean_title(stem);
    if cleaned.is_empty() {
        filename.trim().to_owned()
    } else {
        cleaned
    }
}

/// Underscores as spaces, whitespace collapsed, and stray separators trimmed,
/// keeping the ` - ` of `Artist - Album`.
fn tidy(value: &str) -> String {
    value
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(['-', '.', ' '])
        .to_owned()
}

/// The disc number of a disc folder and the nearest meaningful folder as the
/// album title with its parenthesized year.
fn album_folder(path: &[String]) -> (Option<u16>, Option<(String, Option<u16>)>) {
    let mut disc = None;
    for component in path[..path.len() - 1].iter().rev() {
        let trimmed = component.trim();
        if let Some(captures) = DISC_FOLDER_PATTERN.captures(trimmed) {
            disc = disc.or_else(|| captures["disc"].parse().ok());
            continue;
        }
        if SEASON_FOLDER_PATTERN.is_match(trimmed) {
            continue;
        }
        let year = PARENTHESIZED_YEAR_PATTERN
            .captures(trimmed)
            .and_then(|captures| captures["year"].parse().ok());
        let without_tags = BRACKETED_PATTERN.replace_all(trimmed, " ");
        let without_year = PARENTHESIZED_YEAR_PATTERN.replace_all(&without_tags, " ");
        let title = tidy(&without_year);
        if album_group_key(&title).is_empty() {
            continue;
        }
        return (disc, Some((title, year)));
    }
    (disc, None)
}

fn track_parts(stem: &str, fallback: String) -> (Option<u16>, Option<u16>, String) {
    let Some(captures) = TRACK_PATTERN.captures(stem.trim()) else {
        return (None, None, fallback);
    };
    let disc = captures
        .name("disc")
        .and_then(|value| value.as_str().parse().ok());
    let track = captures
        .name("track")
        .or_else(|| captures.name("only"))
        .and_then(|value| value.as_str().parse().ok());
    let title = tidy(&captures["title"]);
    if title.is_empty() {
        return (disc, track, fallback);
    }
    (disc, track, title)
}

fn year_in(stem: &str) -> Option<u16> {
    PARENTHESIZED_YEAR_PATTERN
        .captures(stem)
        .and_then(|captures| captures["year"].parse().ok())
}

fn normalized_words(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn is_year(word: &str) -> bool {
    word.len() == 4
        && word.bytes().all(|byte| byte.is_ascii_digit())
        && matches!(word.as_bytes()[..2], [b'1', b'9'] | [b'2', b'0'])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(value: &str) -> Vec<String> {
        value.split('/').map(ToOwned::to_owned).collect()
    }

    fn classify(paths: &[&str]) -> Vec<LibraryFile> {
        let owned = paths.iter().map(|value| path(value)).collect::<Vec<_>>();
        classify_library(
            owned
                .iter()
                .enumerate()
                .map(|(index, value)| (index, value.as_slice())),
            None,
        )
    }

    fn one(value: &str) -> LibraryFile {
        let mut files = classify(&[value]);
        assert_eq!(files.len(), 1, "{value}");
        files.remove(0)
    }

    #[test]
    fn kinds_follow_case_insensitive_extensions() {
        assert_eq!(one("Clip.MKV").kind, MediaKind::Video);
        assert_eq!(one("Song.FLAC").extension, "flac");
        for extension in AUDIO_EXTENSIONS {
            assert_eq!(one(&format!("a.{extension}")).kind, MediaKind::Audio);
        }
        assert_eq!(one("film.ogv").kind, MediaKind::Video);
        assert!(classify(&["notes.nfo", "cover.jpg", "file", "x.mkv.part"]).is_empty());
    }

    #[test]
    fn episodes_keep_their_code_and_take_the_episode_name() {
        let file = one("Sample.Show.S01E02.The.Pilot.720p.WEB.mkv");
        let LibraryRole::Episode(episode) = &file.role else {
            panic!("episode");
        };
        assert_eq!(episode.series_title_hint, "Sample Show");
        assert_eq!((episode.season_number, episode.episode_number), (1, 2));
        assert_eq!(file.title, "The Pilot");
        assert_eq!(
            one("North.Shore.Stories.S01E01.1080p.WEB-DL.mkv").title,
            "North Shore Stories S01E01"
        );
        let bare = one("Show/Season 1/S01E03-E04.mkv");
        assert_eq!(bare.title, "S01E03-E04");
        let LibraryRole::Episode(episode) = &bare.role else {
            panic!("episode");
        };
        assert_eq!(episode.ending_episode_number, Some(4));
    }

    #[test]
    fn samples_are_not_library_files_but_sample_titles_are() {
        assert!(classify(&["Movie.2019/Sample/movie-sample.mkv"]).is_empty());
        assert!(classify(&["Movie.2019/sample.mkv"]).is_empty());
        assert!(classify(&["Movie.2019/grp-movie.2019.1080p-sample.mkv"]).is_empty());
        assert!(classify(&["sample-movie.mkv"]).is_empty());
        assert_eq!(classify(&["Sample.Show.S01E01.mkv"]).len(), 1);
        assert_eq!(classify(&["Sample.Movie.Title.2001.mkv"]).len(), 1);
    }

    #[test]
    fn a_single_or_dated_video_is_a_movie() {
        let movie = one("Tears.of.Steel.2012.1080p.mkv");
        assert_eq!(movie.role, LibraryRole::Movie);
        assert_eq!(movie.title, "Tears of Steel");
        assert_eq!(movie.year, Some(2012));
        let undated = one("Big Buck Bunny/big_buck_bunny_1080p.mp4");
        assert_eq!(undated.role, LibraryRole::Movie);
        assert_eq!(undated.title, "big buck bunny");
        assert_eq!(one("2012.2009.mkv").title, "2012");

        let pack = classify(&[
            "Course/01 Intro.mp4",
            "Course/02 Basics.mp4",
            "Course/Bonus Film (1999).mp4",
            "Course/Sample/clip.mp4",
        ]);
        let roles = pack.iter().map(|file| &file.role).collect::<Vec<_>>();
        assert_eq!(
            roles,
            [
                &LibraryRole::Other,
                &LibraryRole::Other,
                &LibraryRole::Movie
            ]
        );
        assert_eq!(pack[2].title, "Bonus Film");
    }

    #[test]
    fn the_torrent_folder_names_albums_shows_and_movies() {
        let paths = [
            vec!["01 - Beastie Boys - Now Get Busy.mp3".to_owned()],
            vec!["S01E02.mkv".to_owned()],
        ];
        let files = classify_library(
            paths
                .iter()
                .enumerate()
                .map(|(index, path)| (index, path.as_slice())),
            Some("The WIRED CD - Rip. Sample. Mash. Share."),
        );
        let LibraryRole::Track(track) = &files[0].role else {
            panic!("track");
        };
        assert_eq!(
            track.album_title_hint.as_deref(),
            Some("The WIRED CD - Rip. Sample. Mash. Share")
        );
        let LibraryRole::Episode(episode) = &files[1].role else {
            panic!("episode");
        };
        assert_eq!(
            series_group_key(&episode.series_title_hint),
            "the wired cd rip sample mash share"
        );
        let movie = classify_library(
            [(0, [String::from("movie.mkv")].as_slice())],
            Some("Some Movie (2019) [1080p]"),
        );
        assert_eq!(
            (movie[0].title.as_str(), movie[0].year),
            ("Some Movie", Some(2019))
        );
    }

    #[test]
    fn an_extra_beside_episodes_is_not_a_movie() {
        let files = classify(&[
            "Show/Season 01/Show.S01E01.mkv",
            "Show/Extras/Behind the scenes.webm",
        ]);
        assert_eq!(files[1].role, LibraryRole::Other);
    }

    #[test]
    fn generic_names_take_a_dated_release_folder_title() {
        let file = one("Some Movie (2019) [1080p]/movie.mkv");
        assert_eq!(file.title, "Some Movie");
        assert_eq!(file.year, Some(2019));
    }

    #[test]
    fn tracks_take_numbers_and_the_nearest_meaningful_folder() {
        let files = classify(&[
            "Artist - Album (2019) [FLAC]/CD1/1-03 - Third Song.flac",
            "Artist - Album (2019) [FLAC]/01. First Song.flac",
            "Artist - Album (2019) [FLAC]/Disc 1/04_Fourth_Song.mp3",
            "loose.mp3",
        ]);
        let LibraryRole::Track(third) = &files[0].role else {
            panic!("track");
        };
        assert_eq!(third.album_title_hint.as_deref(), Some("Artist - Album"));
        assert_eq!((third.disc_number, third.track_number), (Some(1), Some(3)));
        assert_eq!(files[0].title, "Third Song");
        assert_eq!(files[0].year, Some(2019));
        let LibraryRole::Track(first) = &files[1].role else {
            panic!("track");
        };
        assert_eq!((first.disc_number, first.track_number), (None, Some(1)));
        assert_eq!(files[1].title, "First Song");
        let LibraryRole::Track(fourth) = &files[2].role else {
            panic!("track");
        };
        assert_eq!(
            (fourth.disc_number, fourth.track_number),
            (Some(1), Some(4))
        );
        assert_eq!(files[2].title, "Fourth Song");
        let LibraryRole::Track(loose) = &files[3].role else {
            panic!("track");
        };
        assert_eq!(loose.album_title_hint, None);
        assert_eq!(files[3].title, "loose");
    }

    #[test]
    fn group_keys_merge_spelling_variants_only() {
        assert_eq!(series_group_key("Sample Show"), "sample show");
        assert_eq!(series_group_key("Sample.Show 2019"), "sample show");
        assert_eq!(series_group_key("The Office US"), "the office us");
        assert_ne!(
            series_group_key("The Office US"),
            series_group_key("The Office UK")
        );
        assert_eq!(series_group_key("1923"), "1923");
        assert_eq!(series_group_key("Show (2019) Season 1 Complete"), "show");
        assert_eq!(series_group_key("Show S02"), "show");
        assert_eq!(series_group_key("Season 2"), "season 2");
        assert_eq!(
            album_group_key("Artist - Album (2019) [FLAC]"),
            album_group_key("artist_album 320")
        );
        assert_eq!(album_group_key("FLAC"), "");
    }

    #[test]
    fn hostile_names_classify_without_panicking() {
        for value in [
            ".mkv",
            "-.mp3",
            "....flac",
            "S01E01.mkv",
            "(2019).mkv",
            "[x].mp4",
            "東京.mp3",
            "１２３.flac",
        ] {
            for file in classify(&[value]) {
                assert!(!file.title.is_empty(), "{value}");
            }
        }
    }
}
