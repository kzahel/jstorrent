use axum::{
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::Response,
};
use std::sync::Arc;
use crate::AppState;

pub async fn middleware(
    State(state): State<Arc<AppState>>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Allow health check and WebSocket upgrade without auth header
    // WebSocket auth is handled within the protocol
    if req.uri().path() == "/health" || req.uri().path() == "/io" {
        return Ok(next.run(req).await);
    }

    let token = req.headers()
        .get("X-JST-Auth")
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            req.headers()
                .get("Authorization")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.strip_prefix("Bearer "))
        });

    match token {
        Some(t) if t == state.token => {
            Ok(next.run(req).await)
        }
        _ => {
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}
