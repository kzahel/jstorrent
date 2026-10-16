use std::error::Error;
use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    ApplicationError, ApplicationService, OpenViewSetRequest, OpenViewSetResponse, RequestEnvelope,
    ResponseEnvelope, UpdateBatch, UpdateViewSetRequest, ViewSet, ViewSetError, ViewSetOwner,
    application_error_response,
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApplicationCall {
    ProductUpdate {
        request: crate::HostUpdateRequest,
    },
    Dispatch {
        request: Box<RequestEnvelope>,
    },
    OpenViewSet {
        request: OpenViewSetRequest,
    },
    UpdateViewSet {
        view_set_id: String,
        request: UpdateViewSetRequest,
    },
    CloseViewSet {
        view_set_id: String,
    },
    CreateMediaUrl {
        #[schemars(regex(pattern = "^t1-[0-9a-f]{32}$"))]
        torrent_id: String,
        file_index: u32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApplicationCallResult {
    ProductUpdate {
        snapshot: Box<crate::HostUpdateSnapshot>,
    },
    CommandResponse {
        response: Box<ResponseEnvelope>,
    },
    ViewSetOpened {
        response: Box<OpenViewSetResponse>,
    },
    ViewSetUpdated,
    ViewSetClosed,
    MediaUrl {
        response: crate::MediaUrlResponse,
    },
}

#[derive(Debug)]
pub enum ApplicationCallError {
    Application(ApplicationError),
    ViewSet(ViewSetError),
}

impl fmt::Display for ApplicationCallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Application(error) => error.fmt(formatter),
            Self::ViewSet(error) => error.fmt(formatter),
        }
    }
}

impl Error for ApplicationCallError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Application(error) => Some(error),
            Self::ViewSet(error) => Some(error),
        }
    }
}

impl From<ApplicationError> for ApplicationCallError {
    fn from(error: ApplicationError) -> Self {
        Self::Application(error)
    }
}

impl From<ViewSetError> for ApplicationCallError {
    fn from(error: ViewSetError) -> Self {
        Self::ViewSet(error)
    }
}

impl ApplicationService {
    pub async fn application_call(
        &mut self,
        owner: &ViewSetOwner,
        call: ApplicationCall,
    ) -> Result<ApplicationCallResult, ApplicationCallError> {
        match call {
            ApplicationCall::ProductUpdate { request } => {
                let updates = self.host_updates.as_ref().ok_or_else(|| {
                    ApplicationError::Configuration("Host updates are unavailable".into())
                })?;
                let snapshot = updates
                    .request(owner.as_str(), request)
                    .map_err(ApplicationError::Configuration)?;
                Ok(ApplicationCallResult::ProductUpdate {
                    snapshot: Box::new(snapshot),
                })
            }
            ApplicationCall::Dispatch { request } => {
                let request_id = request.request_id.clone();
                let response = match self.dispatch(*request).await {
                    Ok(response) => response,
                    Err(error) => application_error_response(
                        request_id,
                        self.revision().unwrap_or_default(),
                        &error,
                    ),
                };
                Ok(ApplicationCallResult::CommandResponse {
                    response: Box::new(response),
                })
            }
            ApplicationCall::OpenViewSet { request } => Ok(ApplicationCallResult::ViewSetOpened {
                response: Box::new(self.open_view_set(owner.clone(), request)?),
            }),
            ApplicationCall::UpdateViewSet {
                view_set_id,
                request,
            } => {
                self.update_view_set(owner, &view_set_id, request)?;
                Ok(ApplicationCallResult::ViewSetUpdated)
            }
            ApplicationCall::CloseViewSet { view_set_id } => {
                self.close_view_set(owner, &view_set_id)?;
                Ok(ApplicationCallResult::ViewSetClosed)
            }
            ApplicationCall::CreateMediaUrl {
                torrent_id,
                file_index,
            } => Ok(ApplicationCallResult::MediaUrl {
                response: self.create_media_url(&torrent_id, file_index).await?,
            }),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AcknowledgedViewStreamError {
    AcknowledgementOutstanding,
    InvalidAcknowledgement,
    ViewSet(ViewSetError),
}

impl fmt::Display for AcknowledgedViewStreamError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AcknowledgementOutstanding => {
                formatter.write_str("a view batch is awaiting acknowledgement")
            }
            Self::InvalidAcknowledgement => formatter
                .write_str("view stream acknowledgement does not match the delivered cursor"),
            Self::ViewSet(error) => error.fmt(formatter),
        }
    }
}

impl Error for AcknowledgedViewStreamError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::ViewSet(error) => Some(error),
            Self::AcknowledgementOutstanding | Self::InvalidAcknowledgement => None,
        }
    }
}

impl From<ViewSetError> for AcknowledgedViewStreamError {
    fn from(error: ViewSetError) -> Self {
        Self::ViewSet(error)
    }
}

#[derive(Clone, Debug)]
pub struct AcknowledgedViewStream {
    view_set: ViewSet,
    applied_cursor: String,
    emitted_cursor: Option<String>,
}

impl AcknowledgedViewStream {
    pub fn new(view_set: ViewSet, applied_cursor: String) -> Self {
        Self {
            view_set,
            applied_cursor,
            emitted_cursor: None,
        }
    }

    pub fn view_set_id(&self) -> &str {
        self.view_set.id()
    }

    pub fn applied_cursor(&self) -> &str {
        &self.applied_cursor
    }

    pub fn emitted_cursor(&self) -> Option<&str> {
        self.emitted_cursor.as_deref()
    }

    pub async fn next_batch(
        &mut self,
        max_wait_millis: u32,
    ) -> Result<UpdateBatch, AcknowledgedViewStreamError> {
        if self.emitted_cursor.is_some() {
            return Err(AcknowledgedViewStreamError::AcknowledgementOutstanding);
        }
        let batch = self
            .view_set
            .next_updates(&self.applied_cursor, max_wait_millis)
            .await?;
        self.emitted_cursor = Some(batch.cursor.clone());
        Ok(batch)
    }

    pub fn acknowledge(&mut self, cursor: &str) -> Result<(), AcknowledgedViewStreamError> {
        if self.emitted_cursor.as_deref() != Some(cursor) {
            return Err(AcknowledgedViewStreamError::InvalidAcknowledgement);
        }
        self.applied_cursor.clear();
        self.applied_cursor.push_str(cursor);
        self.emitted_cursor = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        OpenViewSetOptions, OpenViewSetRequest, ServiceSnapshot, ViewDeliveryPolicy, ViewHub,
        ViewSetOwner, ViewSpec,
    };

    use super::{AcknowledgedViewStream, AcknowledgedViewStreamError};

    #[tokio::test]
    async fn acknowledgement_must_match_the_one_emitted_cursor() {
        let hub = ViewHub::new(&ServiceSnapshot {
            profile_id: "test".to_owned(),
            revision: "0".to_owned(),
            storage: Default::default(),
            client_settings: Default::default(),
            torrents: Vec::new(),
        })
        .expect("view hub");
        let owner = ViewSetOwner::trusted("connection-test");
        let opened = hub
            .open_view_set(
                owner.clone(),
                OpenViewSetRequest {
                    views: vec![ViewSpec::TorrentList {
                        view_id: "library".to_owned(),
                        delivery: ViewDeliveryPolicy::default(),
                    }],
                    options: OpenViewSetOptions::default(),
                },
            )
            .expect("open view set");
        let view_set = hub.view_set(&owner, &opened.view_set_id).expect("view set");
        let mut stream = AcknowledgedViewStream::new(view_set, opened.initial.cursor);

        let batch = stream.next_batch(0).await.expect("empty batch");
        assert_eq!(stream.emitted_cursor(), Some(batch.cursor.as_str()));
        assert_eq!(
            stream.next_batch(0).await,
            Err(AcknowledgedViewStreamError::AcknowledgementOutstanding)
        );
        assert_eq!(
            stream.acknowledge("999"),
            Err(AcknowledgedViewStreamError::InvalidAcknowledgement)
        );
        stream
            .acknowledge(&batch.cursor)
            .expect("exact acknowledgement");
        assert_eq!(stream.applied_cursor(), batch.cursor);
        assert_eq!(stream.emitted_cursor(), None);
        assert_eq!(
            stream.acknowledge(&batch.cursor),
            Err(AcknowledgedViewStreamError::InvalidAcknowledgement)
        );
    }
}
