//! spotatui's Web API failure, as its Spotify modules raise it; the server
//! answers its status and body.
#![allow(dead_code)]

#[derive(Debug)]
pub struct SpotifyApiError {
  pub status: reqwest::StatusCode,
  pub(crate) body: String,
  pub(crate) localized_body: Option<crate::core::i18n::LocalizedMessage>,
  pub(crate) detail: Option<String>,
  pub(crate) endpoint: Option<String>,
}

impl std::fmt::Display for SpotifyApiError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(f, "Spotify API {} failed: {}", self.status, self.body)?;
    if let Some(detail) = &self.detail {
      write!(f, " ({detail})")?;
    }
    Ok(())
  }
}

impl std::error::Error for SpotifyApiError {}

pub fn is_forbidden_error(e: &anyhow::Error) -> bool {
  e.downcast_ref::<SpotifyApiError>()
    .is_some_and(|error| error.status == reqwest::StatusCode::FORBIDDEN)
}
