//! Recently played, as the official client lists it: its contexts (albums,
//! playlists, artists, Liked Songs), newest first, from spclient's
//! recently-played. Not spotatui's (that one reads the app's own history).
//! The Web API's shape, with each item's `context` and no `track`: a reader
//! asks for the context it shows.
use super::session::SpotifySession;
use chrono::{TimeZone, Utc};
use reqwest::Method;
use serde_json::{json, Value};

pub async fn recently_played(session: &SpotifySession, limit: usize) -> anyhow::Result<Value> {
  let username = session.username();
  let endpoint = format!(
    "/recently-played/v3/user/{username}/recently-played?format=json&offset=0&limit={}&filter=default,collection-new-episodes&market=from_token",
    limit.clamp(1, 50)
  );
  let bytes = session
    .session()
    .spclient()
    .request_as_json(&Method::GET, &endpoint, None, None)
    .await
    .map_err(super::router::upstream_error)?;
  let answer: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
  Ok(items(&answer))
}

fn context_type(uri: &str) -> &'static str {
  if uri.ends_with(":collection") {
    return "collection";
  }
  match uri.split(':').nth(1) {
    Some("album") => "album",
    Some("playlist") => "playlist",
    Some("artist") => "artist",
    Some("show") => "show",
    _ => "other",
  }
}

fn items(answer: &Value) -> Value {
  let contexts = answer["playContexts"].as_array().cloned().unwrap_or_default();
  let items: Vec<Value> = contexts
    .iter()
    .filter_map(|context| {
      let uri = context["uri"].as_str()?;
      let played_at = context["lastPlayedTime"]
        .as_i64()
        .and_then(|ms| Utc.timestamp_millis_opt(ms).single())
        .map(|at| at.to_rfc3339())
        .unwrap_or_default();
      Some(json!({
        "played_at": played_at,
        "context": { "uri": uri, "type": context_type(uri) },
        "track": context["lastPlayedTrackUri"].as_str().map(|track| json!({ "uri": track })),
      }))
    })
    .collect();
  json!({ "items": items, "next": null, "limit": items.len() })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn contexts_become_items_newest_first() {
    let answer = json!({ "playContexts": [
      { "uri": "spotify:album:a1", "lastPlayedTime": 1700000000000i64, "lastPlayedTrackUri": "spotify:track:t1" },
      { "uri": "spotify:user:me:collection", "lastPlayedTime": 1690000000000i64 },
      { "notAContext": true },
    ]});
    let out = items(&answer);
    assert_eq!(out["items"].as_array().unwrap().len(), 2);
    assert_eq!(out["items"][0]["context"], json!({ "uri": "spotify:album:a1", "type": "album" }));
    assert_eq!(out["items"][0]["track"]["uri"], "spotify:track:t1");
    assert_eq!(out["items"][1]["context"]["type"], "collection");
    assert!(out["items"][1]["track"].is_null());
  }
}
