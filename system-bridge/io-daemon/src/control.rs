use axum::{
    routing::post,
    Router,
};
use std::sync::Arc;
use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/control/shutdown", post(shutdown))
        .route("/control/ping", post(ping))
}

async fn shutdown() {
    tracing::info!("Shutdown requested via API");
    std::process::exit(0);
}

async fn ping() -> &'static str {
    "pong"
}
