//! Spotify through the official client's internal API, over a librespot
//! session: spotatui's src/infra/spotify (see UPSTREAM for the commit,
//! LICENSE-spotatui), with `listening` our own and its Cast, LAN and
//! zeroconf speakers stubbed (lan.rs).
#![allow(dead_code)]

mod browse;
mod cast;
mod catalog;
pub mod credentials;
mod json;
mod lan;
mod library;
mod listening;
mod lyrics;
mod metadata;
mod player;
mod playlists;
mod router;
mod search;
pub mod session;
mod zeroconf;

pub use router::route;
