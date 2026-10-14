//! Generates a populated product-state database fixture with the code under
//! test. Run it unmodified in a worktree at a release tag (see
//! `tests/fixtures/product/README.md`):
//!
//! ```text
//! RSTORRENT_PRODUCT_FIXTURE_OUT=/tmp/product-v2.sqlite \
//!     cargo test -p rstorrent-session --test product_fixture_generator -- --ignored
//! ```

use std::path::Path;

use rstorrent_session::{ProductMilestone, ProductMilestoneKind, ProductStateStore};

#[test]
#[ignore = "writes a product fixture; run explicitly at a release tag"]
fn generate_product_fixture() {
    let output = std::env::var_os("RSTORRENT_PRODUCT_FIXTURE_OUT")
        .expect("set RSTORRENT_PRODUCT_FIXTURE_OUT to the fixture path");
    let output = Path::new(&output);
    assert!(!output.exists(), "refusing to overwrite {output:?}");
    let work = tempfile::tempdir().expect("temporary directory");
    let mut store = ProductStateStore::open(work.path(), "1.0.31", None).expect("open product");
    store
        .acknowledge_disclosure(false)
        .expect("disclosure with opt-out");
    store.record_foreground_session().expect("session");
    store
        .apply_milestones(&[
            ProductMilestone {
                source_epoch: [7; 16],
                sequence: 1,
                kind: ProductMilestoneKind::TorrentAdded,
            },
            ProductMilestone {
                source_epoch: [7; 16],
                sequence: 2,
                kind: ProductMilestoneKind::DownloadCompleted,
            },
        ])
        .expect("milestones");
    store.record_clean_shutdown().expect("clean shutdown");
    let path = store
        .database_path()
        .expect("durable product path")
        .to_owned();
    drop(store);
    let connection = rusqlite::Connection::open(path).expect("reopen");
    connection
        .execute(
            "VACUUM INTO ?1",
            [output.to_str().expect("UTF-8 output path")],
        )
        .expect("write fixture");
}
