# Released Product-State Fixtures

Each `v<N>.sqlite` is a populated `product.db` written by the code of a public
release that ships product schema `N`. Tests in `src/product_state.rs` open it
with current code and require every value to survive (except the start
version and time that every open records), the migrated schema to equal a
fresh database's, and the frozen baseline to equal the released schema. Never
edit or regenerate a fixture for a released schema; see the session catalog
fixture README for the release-tag procedure, using
`tests/product_fixture_generator.rs` and `RSTORRENT_PRODUCT_FIXTURE_OUT`.

| Fixture | Release tag | Commit | SHA-256 |
| --- | --- | --- | --- |
| `v2.sqlite` | `android-v1.0.31` (product schema 2, as every public release) | `70150ec99ff5613bb468fd816fed46c687ff7557` | `27f0f591f481c0d4498970bd00854382ec89f1f04111be2592f540f547797c96` |

The fixture records an acknowledged disclosure with statistics turned off,
one foreground session, one added and one completed torrent, one source
watermark and a clean shutdown.
