#![forbid(unsafe_code)]

use std::env;
use std::ffi::OsString;
use std::fmt;
use std::io::{Read as _, Write as _};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use base64::Engine as _;
use rstorrent_remote_relay::{ProductRelayOptions, TlsProductRelayServer};
use serde::Serialize;

const USAGE: &str = "Usage: rstorrent-remote-relay \\
  --root ABSOLUTE_PATH \\
  --listen LOOPBACK_IP:PORT \\
  --client-origin HTTPS_ORIGIN [--client-origin HTTPS_ORIGIN] \\
  --certificate-der ABSOLUTE_PATH \\
  --private-key-der ABSOLUTE_PATH \
  [--trusted-proxy LOOPBACK_IP \
   --operator-token-file ABSOLUTE_PATH]";

#[derive(Debug, Eq, PartialEq)]
struct Arguments {
    root: PathBuf,
    listen: SocketAddr,
    client_origins: Vec<String>,
    certificate_der: PathBuf,
    private_key_der: PathBuf,
    trusted_proxy: Option<IpAddr>,
    operator_token_file: Option<PathBuf>,
}

impl Arguments {
    fn parse(arguments: impl IntoIterator<Item = OsString>) -> Result<Self, ArgumentError> {
        let mut root = None;
        let mut listen = None;
        let mut client_origins = Vec::new();
        let mut certificate_der = None;
        let mut private_key_der = None;
        let mut trusted_proxy = None;
        let mut operator_token_file = None;
        let mut arguments = arguments.into_iter();
        while let Some(argument) = arguments.next() {
            let value = arguments.next().ok_or(ArgumentError::Usage)?;
            match argument.to_str() {
                Some("--root") if root.is_none() => root = Some(PathBuf::from(value)),
                Some("--listen") if listen.is_none() => {
                    listen = Some(
                        value
                            .to_str()
                            .ok_or(ArgumentError::Usage)?
                            .parse()
                            .map_err(|_| ArgumentError::Usage)?,
                    );
                }
                Some("--client-origin") if client_origins.len() < 2 => {
                    client_origins.push(value.into_string().map_err(|_| ArgumentError::Usage)?);
                }
                Some("--certificate-der") if certificate_der.is_none() => {
                    certificate_der = Some(PathBuf::from(value));
                }
                Some("--private-key-der") if private_key_der.is_none() => {
                    private_key_der = Some(PathBuf::from(value));
                }
                Some("--trusted-proxy") if trusted_proxy.is_none() => {
                    trusted_proxy = Some(
                        value
                            .to_str()
                            .ok_or(ArgumentError::Usage)?
                            .parse()
                            .map_err(|_| ArgumentError::Usage)?,
                    );
                }
                Some("--operator-token-file") if operator_token_file.is_none() => {
                    operator_token_file = Some(PathBuf::from(value));
                }
                _ => return Err(ArgumentError::Usage),
            }
        }
        let arguments = Self {
            root: root.ok_or(ArgumentError::Usage)?,
            listen: listen.ok_or(ArgumentError::Usage)?,
            client_origins,
            certificate_der: certificate_der.ok_or(ArgumentError::Usage)?,
            private_key_der: private_key_der.ok_or(ArgumentError::Usage)?,
            trusted_proxy,
            operator_token_file,
        };
        if !arguments.root.is_absolute()
            || !arguments.certificate_der.is_absolute()
            || !arguments.private_key_der.is_absolute()
            || !arguments.listen.ip().is_loopback()
            || arguments
                .trusted_proxy
                .is_some_and(|proxy| !proxy.is_loopback())
            || arguments
                .operator_token_file
                .as_ref()
                .is_some_and(|path| !path.is_absolute())
            || arguments.trusted_proxy.is_some() != arguments.operator_token_file.is_some()
            || arguments.client_origins.is_empty()
            || (arguments.client_origins.len() == 2
                && arguments.client_origins[0] == arguments.client_origins[1])
            || (arguments.trusted_proxy.is_none() && arguments.client_origins.len() != 1)
            || (arguments.trusted_proxy.is_some()
                && arguments.client_origins.iter().any(|origin| {
                    !matches!(
                        origin.as_str(),
                        "https://jstorrent.com" | "https://remote.jstorrent.com"
                    )
                }))
        {
            return Err(ArgumentError::Usage);
        }
        Ok(arguments)
    }
}

#[derive(Debug)]
enum ArgumentError {
    Usage,
}

impl fmt::Display for ArgumentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(USAGE)
    }
}

impl std::error::Error for ArgumentError {}

#[derive(Serialize)]
struct Ready<'a> {
    event: &'a str,
    address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    relay_id: Option<String>,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = Arguments::parse(env::args_os().skip(1))?;
    let production = arguments.trusted_proxy.is_some();
    let server = match (arguments.trusted_proxy, arguments.operator_token_file) {
        (Some(trusted_proxy), Some(operator_token_file)) => {
            let operator_token = read_operator_token(&operator_token_file)?;
            TlsProductRelayServer::bind_with_options(
                arguments.listen,
                arguments.root,
                ProductRelayOptions::production_with_origins(
                    trusted_proxy,
                    operator_token,
                    arguments.client_origins,
                )?,
                arguments.certificate_der,
                arguments.private_key_der,
            )
            .await?
        }
        (None, None) => {
            TlsProductRelayServer::bind(
                arguments.listen,
                arguments.root,
                arguments
                    .client_origins
                    .into_iter()
                    .next()
                    .ok_or(ArgumentError::Usage)?,
                arguments.certificate_der,
                arguments.private_key_der,
            )
            .await?
        }
        _ => return Err(ArgumentError::Usage.into()),
    };
    let relay = server.relay();
    let shutdown = shutdown_signal()?;
    tokio::pin!(shutdown);
    println!(
        "{}",
        serde_json::to_string(&Ready {
            event: "ready",
            address: server.local_addr().to_string(),
            relay_id: (!production).then(|| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(relay.deployment_id())
            }),
        })?
    );
    std::io::stdout().flush()?;
    let serving = server.serve();
    tokio::pin!(serving);
    tokio::select! {
        result = &mut serving => result?,
        () = &mut shutdown => {
            relay.shutdown();
            serving.await?;
        }
    }
    Ok(())
}

fn read_operator_token(path: &std::path::Path) -> Result<String, std::io::Error> {
    const MAXIMUM: usize = 256;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "operator token must be a regular non-symlink file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        let mode = metadata.permissions().mode() & 0o777;
        if metadata.uid() != rustix::process::getuid().as_raw() || !matches!(mode, 0o400 | 0o600) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "operator token ownership or mode",
            ));
        }
    }
    let mut encoded = Vec::with_capacity(64);
    std::fs::File::open(path)?
        .take((MAXIMUM + 2) as u64)
        .read_to_end(&mut encoded)?;
    if encoded.last() == Some(&b'\n') {
        encoded.pop();
    }
    String::from_utf8(encoded).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "operator token must be UTF-8",
        )
    })
}

#[cfg(unix)]
fn shutdown_signal() -> Result<impl std::future::Future<Output = ()>, std::io::Error> {
    use tokio::signal::unix::{SignalKind, signal};

    let mut terminate = signal(SignalKind::terminate())?;
    Ok(async move {
        tokio::select! {
            result = tokio::signal::ctrl_c() => { let _ = result; }
            _ = terminate.recv() => {}
        }
    })
}

#[cfg(not(unix))]
fn shutdown_signal() -> Result<impl std::future::Future<Output = ()>, std::io::Error> {
    Ok(async {
        let _ = tokio::signal::ctrl_c().await;
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_require_complete_absolute_loopback_configuration() {
        let root = env::temp_dir().join("relay-root");
        let certificate = env::temp_dir().join("relay-cert.der");
        let key = env::temp_dir().join("relay-key.der");
        let parsed = Arguments::parse([
            OsString::from("--root"),
            root.clone().into_os_string(),
            OsString::from("--listen"),
            OsString::from("127.0.0.1:8443"),
            OsString::from("--client-origin"),
            OsString::from("https://127.0.0.1:7443"),
            OsString::from("--certificate-der"),
            certificate.clone().into_os_string(),
            OsString::from("--private-key-der"),
            key.clone().into_os_string(),
        ])
        .unwrap();
        assert_eq!(parsed.root, root);
        assert_eq!(parsed.certificate_der, certificate);
        assert_eq!(parsed.private_key_der, key);
        assert_eq!(parsed.trusted_proxy, None);
        assert_eq!(parsed.operator_token_file, None);
        assert!(Arguments::parse(Vec::<OsString>::new()).is_err());
        assert!(
            Arguments::parse([
                OsString::from("--root"),
                OsString::from("relative"),
                OsString::from("--listen"),
                OsString::from("0.0.0.0:8443"),
                OsString::from("--client-origin"),
                OsString::from("https://127.0.0.1:7443"),
                OsString::from("--certificate-der"),
                certificate.into_os_string(),
                OsString::from("--private-key-der"),
                key.into_os_string(),
            ])
            .is_err()
        );
    }

    #[test]
    fn production_arguments_fix_the_public_origin_and_pair_private_inputs() {
        let root = env::temp_dir().join("relay-root");
        let certificate = env::temp_dir().join("relay-cert.der");
        let key = env::temp_dir().join("relay-key.der");
        let token = env::temp_dir().join("relay-operator-token");
        let common = [
            OsString::from("--root"),
            root.into_os_string(),
            OsString::from("--listen"),
            OsString::from("127.0.0.1:8443"),
            OsString::from("--client-origin"),
            OsString::from("https://jstorrent.com"),
            OsString::from("--certificate-der"),
            certificate.into_os_string(),
            OsString::from("--private-key-der"),
            key.into_os_string(),
        ];
        let parsed = Arguments::parse(common.clone().into_iter().chain([
            OsString::from("--trusted-proxy"),
            OsString::from("127.0.0.1"),
            OsString::from("--operator-token-file"),
            token.clone().into_os_string(),
        ]))
        .unwrap();
        assert_eq!(parsed.trusted_proxy, Some("127.0.0.1".parse().unwrap()));
        assert_eq!(parsed.operator_token_file, Some(token));
        for extra in [
            vec!["--client-origin", "https://remote.jstorrent.com"],
            vec!["--client-origin", "https://jstorrent.com"],
            vec![
                "--client-origin",
                "https://remote.jstorrent.com",
                "--client-origin",
                "https://jstorrent.com",
            ],
        ] {
            let should_accept = extra.len() == 2 && extra[1] == "https://remote.jstorrent.com";
            let values = common
                .clone()
                .into_iter()
                .chain([
                    OsString::from("--trusted-proxy"),
                    OsString::from("127.0.0.1"),
                    OsString::from("--operator-token-file"),
                    env::temp_dir().join("token").into_os_string(),
                ])
                .chain(extra.into_iter().map(OsString::from));
            assert_eq!(Arguments::parse(values).is_ok(), should_accept);
        }
        let ready = serde_json::to_value(Ready {
            event: "ready",
            address: parsed.listen.to_string(),
            relay_id: None,
        })
        .unwrap();
        assert_eq!(ready["event"], "ready");
        assert_eq!(ready["address"], "127.0.0.1:8443");
        assert!(ready.get("relay_id").is_none());
        assert!(
            Arguments::parse(common.clone().into_iter().chain([
                OsString::from("--trusted-proxy"),
                OsString::from("127.0.0.1"),
            ]))
            .is_err()
        );
        for origin in [
            "https://example.com",
            "https://rstorrent.com",
            "https://www.jstorrent.com",
        ] {
            let wrong_origin = common.clone().map(|value| {
                if value == "https://jstorrent.com" {
                    OsString::from(origin)
                } else {
                    value
                }
            });
            assert!(
                Arguments::parse(wrong_origin.into_iter().chain([
                    OsString::from("--trusted-proxy"),
                    OsString::from("127.0.0.1"),
                    OsString::from("--operator-token-file"),
                    env::temp_dir().join("token").into_os_string(),
                ]))
                .is_err()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn operator_token_file_is_bounded_owner_only_and_accepts_one_newline() {
        use std::os::unix::fs::PermissionsExt as _;

        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("operator-token");
        std::fs::write(&path, b"abcdefghijklmnopqrstuvwxyz012345\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        assert_eq!(
            read_operator_token(&path).unwrap(),
            "abcdefghijklmnopqrstuvwxyz012345"
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_operator_token(&path).is_err());
    }
}
