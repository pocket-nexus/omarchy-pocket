//! spotatui's localized messages, in English only: the device's service
//! words what the applet shows.
#![allow(dead_code)]

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Language {
  #[default]
  Auto,
  En,
  ZhHans,
  ZhHant,
}

#[derive(Debug, Clone, Copy)]
pub struct InfraStatusStrings {
  pub search_query_unavailable: &'static str,
  pub made_for_you_unavailable: &'static str,
  pub made_for_you_missing: &'static str,
  pub speaker_not_joined: &'static str,
  pub playlist_changed: &'static str,
  pub cast_malformed: &'static str,
}

impl InfraStatusStrings {
  pub fn search_query_unavailable(&self, operation: &str) -> String {
    self.search_query_unavailable.replace("{operation}", operation)
  }
  pub fn speaker_not_joined(&self, name: &str) -> String {
    self.speaker_not_joined.replace("{name}", name)
  }
}

#[derive(Debug, Clone, Copy)]
pub struct StatusStrings {
  pub infra: InfraStatusStrings,
}

#[derive(Debug, Clone, Copy)]
pub struct Strings {
  pub status: StatusStrings,
}

pub static EN: Strings = Strings {
  status: StatusStrings {
    infra: InfraStatusStrings {
      search_query_unavailable: "Search is unavailable: every known {operation} hash is retired",
      made_for_you_unavailable: "Made for you is unavailable right now",
      made_for_you_missing: "Spotify has no Made for you page for this account",
      speaker_not_joined: "{name} did not join",
      playlist_changed: "The playlist changed since it loaded; open it again and retry",
      cast_malformed: "The speaker answered something unreadable",
    },
  },
};
pub static ZH_HANS: Strings = EN;
pub static ZH_HANT: Strings = EN;

#[derive(Debug, Clone)]
pub struct LocalizedMessage {
  english: String,
}

impl LocalizedMessage {
  pub fn new(render: impl Fn(&Strings) -> String) -> Self {
    Self { english: render(&EN) }
  }

  pub fn map(self, render: impl Fn(&str) -> String) -> Self {
    Self { english: render(&self.english) }
  }

  pub fn text(&self, _language: Language) -> &str {
    &self.english
  }
}

impl std::fmt::Display for LocalizedMessage {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(&self.english)
  }
}

impl std::error::Error for LocalizedMessage {}
