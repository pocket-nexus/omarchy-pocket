//! omarchy-pocket-spotify: Spotify on Omarchy Pocket, for omarchy-pocketd's
//! spotify service (daemon/spotify.ts), which starts it and is its only caller.
//!
//!   omarchy-pocket-spotify --cache <dir> [--port 4471] [--name "Omarchy Pocket"] [--sink <command>] [--speaker librespot|none]
//!
//! Every request carries `x-pocket-key: $OMARCHY_POCKET_SPOTIFY_KEY` (the
//! daemon makes one per start), and the server listens on 127.0.0.1 only:
//!
//!   GET  /status          the sign-in, the pairing waiting, the speaker
//!   POST /login           a pairing code (Spotify's desktop client, OAuth
//!                         device authorization: the owner confirms it at
//!                         spotify.com/pair); the login is kept in <dir>
//!   POST /login/cancel    forget the pairing waiting
//!   POST /logout          forget the login and stop the speaker
//!   *    /v1/<path>       a Web API path, answered from Spotify's internal API
//!                         (spotatui's router), in the Web API's JSON
//!
//! Once signed in it is this device's Spotify Connect speaker: librespot's
//! Spirc with its player writing 16-bit PCM at 44.1 kHz to `--sink`'s stdin
//! (pw-cat into PipeWire by default), softvol, 320 kbps, the device id kept
//! in <dir> so a restart is the same speaker. Spotify refuses the audio keys
//! to librespot for some accounts (`error audio key 0 1`, every track
//! unplayable): after three unplayable tracks in a row the speaker's state is
//! `refused`, and omarchy-pocketd offers Spotify's own player, Soloist, in its
//! place. With `--speaker none` the program starts no speaker (Soloist is it).

mod core;
mod infra;

use anyhow::{anyhow, Context, Result};
use axum::body::Bytes;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use infra::network::requests::SpotifyApiError;
use infra::spotify::{credentials, session};
use librespot_connect::{ConnectConfig, Spirc};
use librespot_core::cache::Cache;
use librespot_core::config::{DeviceType, SessionConfig};
use librespot_core::session::Session;
use librespot_playback::audio_backend;
use librespot_playback::config::{AudioFormat, Bitrate, PlayerConfig};
use librespot_playback::mixer::softmixer::SoftMixer;
use librespot_playback::mixer::{Mixer, MixerConfig};
use librespot_playback::player::Player;
use log::{info, warn};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const DEFAULT_PORT: u16 = 4471;
const DEFAULT_NAME: &str = "Omarchy Pocket";
/// raw PCM on stdin: without --raw, pw-cat reads "-" as a sound file and refuses it
const DEFAULT_SINK: &str = "pw-cat --playback --raw --format s16 --rate 44100 --channels 2 --latency 120ms --media-role Music -";
const INITIAL_VOLUME: u16 = 52_428; // 80 %

struct Args {
  cache: PathBuf,
  port: u16,
  name: String,
  sink: String,
  speaker: bool,
}

fn args() -> Result<Args> {
  let mut cache = None;
  let mut port = DEFAULT_PORT;
  let mut name = DEFAULT_NAME.to_string();
  let mut sink = DEFAULT_SINK.to_string();
  let mut speaker = true;
  let mut it = std::env::args().skip(1);
  while let Some(arg) = it.next() {
    let mut value = || it.next().ok_or_else(|| anyhow!("{arg} needs a value"));
    match arg.as_str() {
      "--cache" => cache = Some(PathBuf::from(value()?)),
      "--port" => port = value()?.parse().context("--port")?,
      "--name" => name = value()?,
      "--sink" => sink = value()?,
      "--speaker" => {
        speaker = match value()?.as_str() {
          "librespot" => true,
          "none" => false,
          other => return Err(anyhow!("--speaker is librespot or none, not {other}")),
        }
      }
      other => return Err(anyhow!("unknown argument {other}")),
    }
  }
  Ok(Args { cache: cache.ok_or_else(|| anyhow!("--cache <dir> is needed"))?, port, name, sink, speaker })
}

#[derive(Default)]
struct Pairing {
  url: String,
  code: String,
  expires_at: u64,
  task: Option<tokio::task::JoinHandle<()>>,
}

struct SpeakerHandle {
  spirc: Spirc,
  session: Session,
}

#[derive(Default)]
struct Inner {
  pairing: Option<Pairing>,
  error: String,
  premium: Option<bool>,
  user: Option<Value>,
  speaker_state: &'static str,
  speaker_message: String,
  speaker: Option<SpeakerHandle>,
  /// counts speaker starts, so a stale restart does not replace a newer one
  generation: u64,
}

struct App {
  key: String,
  /// librespot is this device's speaker; false when Soloist is
  speaker: bool,
  /// --cache: the route file lives here
  cache: PathBuf,
  name: String,
  sink: String,

  inner: Mutex<Inner>,
}

type Shared = Arc<App>;

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The directory session.rs keeps the login in (credentials.rs).
fn login_dir() -> Option<PathBuf> {
  credentials::get_default_cache_path()
}

/// The speaker's device id, made once and kept.
fn device_id(dir: &std::path::Path) -> String {
  let file = dir.join("device_id");
  if let Ok(id) = std::fs::read_to_string(&file) {
    let id = id.trim().to_string();
    if id.len() == 40 && id.chars().all(|c| c.is_ascii_hexdigit()) {
      return id;
    }
  }
  let mut raw = [0u8; 20];
  rand::Rng::fill_bytes(&mut rand::rng(), &mut raw);
  let id: String = raw.iter().map(|b| format!("{b:02x}")).collect();
  let _ = std::fs::write(&file, &id);
  id
}

fn start_speaker(app: Shared) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
  Box::pin(async move {
    if app.speaker {
      start_speaker_now(app).await;
    }
  })
}

async fn start_speaker_now(app: Shared) {
  let generation = {
    let mut inner = app.inner.lock().await;
    if let Some(old) = inner.speaker.take() {
      old.spirc.shutdown().ok();
      old.session.shutdown();
    }
    inner.generation += 1;
    inner.speaker_state = "starting";
    inner.speaker_message.clear();
    inner.generation
  };
  match open_speaker(&app).await {
    Ok((handle, task)) => {
      {
        let mut inner = app.inner.lock().await;
        if inner.generation != generation {
          handle.spirc.shutdown().ok();
          return;
        }
        inner.speaker = Some(handle);
        inner.speaker_state = "ready";
      }
      info!("speaker ready");
      let app = app.clone();
      tokio::spawn(async move {
        task.await;
        let again = {
          let mut inner = app.inner.lock().await;
          if inner.generation != generation {
            false
          } else {
            inner.speaker = None;
            inner.speaker_state = "error";
            inner.speaker_message = "The speaker lost Spotify; connecting again".into();
            true
          }
        };
        if again && credentials::streaming_credentials_are_cached().unwrap_or(false) {
          warn!("speaker stopped; starting it again in 5 s");
          tokio::time::sleep(Duration::from_secs(5)).await;
          start_speaker(app).await;
        }
      });
    }
    Err(e) => {
      warn!("speaker failed: {e:#}");
      let retry = {
        let mut inner = app.inner.lock().await;
        if inner.generation == generation {
          inner.speaker_state = "error";
          inner.speaker_message = format!("{e:#}");
        }
        inner.generation == generation
      };
      if retry && credentials::streaming_credentials_are_cached().unwrap_or(false) {
        let app = app.clone();
        tokio::spawn(async move {
          tokio::time::sleep(Duration::from_secs(30)).await;
          if app.inner.lock().await.generation == generation {
            start_speaker(app.clone()).await;
          }
        });
      }
    }
  }
}

async fn open_speaker(app: &Shared) -> Result<(SpeakerHandle, impl std::future::Future<Output = ()> + Send + 'static)> {
  let dir = login_dir().ok_or_else(|| anyhow!("no login directory"))?;
  crate::core::paths::ensure_private_dir(&dir)?;
  let cache = Cache::new(Some(dir.clone()), Some(dir.clone()), None, None)?;
  let credentials = cache.credentials().ok_or_else(|| anyhow!("not signed in"))?;
  let mut config = SessionConfig { proxy: credentials::streaming_proxy_from_env(), ..Default::default() };
  config.device_id = device_id(&dir);
  let session = Session::new(config, Some(cache));
  let player_config = PlayerConfig { bitrate: Bitrate::Bitrate320, ..Default::default() };
  let mixer = Arc::new(SoftMixer::open(MixerConfig::default()).context("softvol")?);
  mixer.set_volume(INITIAL_VOLUME);
  let backend = audio_backend::find(Some("subprocess".into())).ok_or_else(|| anyhow!("no subprocess sink"))?;
  let sink = app.sink.clone();
  let player = Player::new(player_config, session.clone(), mixer.get_soft_volume(), move || backend(Some(sink.clone()), AudioFormat::S16));
  watch_refusals(Arc::downgrade(app), player.get_player_event_channel());
  let connect = ConnectConfig {
    name: app.name.clone(),
    device_type: DeviceType::GameConsole,
    initial_volume: INITIAL_VOLUME,
    ..Default::default()
  };
  let (spirc, task) = tokio::time::timeout(Duration::from_secs(30), Spirc::new(connect, session.clone(), credentials, player, mixer))
    .await
    .map_err(|_| anyhow!("Spotify did not answer the speaker within 30 s"))?
    .map_err(|e| anyhow!("{e:?}"))?;
  Ok((SpeakerHandle { spirc, session }, async move {
    let _ = task.await;
  }))
}

/// Three unplayable tracks in a row, none playing between them: Spotify
/// refuses this speaker the audio keys.
const REFUSED_AFTER: u32 = 3;

fn watch_refusals(app: std::sync::Weak<App>, mut events: librespot_playback::player::PlayerEventChannel) {
  use librespot_playback::player::PlayerEvent;
  tokio::spawn(async move {
    let mut unplayable = 0u32;
    while let Some(event) = events.recv().await {
      let Some(app) = app.upgrade() else { break };
      match event {
        PlayerEvent::Unavailable { .. } => {
          unplayable += 1;
          if unplayable == REFUSED_AFTER {
            warn!("speaker: {REFUSED_AFTER} tracks in a row were unplayable; Spotify refuses this speaker the audio keys");
            let mut inner = app.inner.lock().await;
            inner.speaker_state = "refused";
            inner.speaker_message = "Spotify does not send this speaker the audio keys for this account.".into();
          }
        }
        PlayerEvent::Playing { .. } => {
          if unplayable >= REFUSED_AFTER {
            let mut inner = app.inner.lock().await;
            if inner.speaker_state == "refused" {
              inner.speaker_state = "ready";
              inner.speaker_message.clear();
            }
          }
          unplayable = 0;
        }
        _ => {}
      }
    }
  });
}

async fn stop_speaker(app: &App) {
  let mut inner = app.inner.lock().await;
  inner.generation += 1;
  if let Some(old) = inner.speaker.take() {
    old.spirc.shutdown().ok();
    old.session.shutdown();
  }
  inner.speaker_state = "off";
  inner.speaker_message.clear();
}

fn allowed(app: &App, headers: &HeaderMap) -> bool {
  headers.get("x-pocket-key").and_then(|v| v.to_str().ok()) == Some(app.key.as_str())
}

fn refuse() -> Response {
  (StatusCode::FORBIDDEN, Json(json!({ "error": { "status": 403, "message": "no key" } }))).into_response()
}

async fn status(State(app): State<Shared>, headers: HeaderMap) -> Response {
  if !allowed(&app, &headers) {
    return refuse();
  }
  let signed_in = credentials::streaming_credentials_are_cached().unwrap_or(false);
  // who is signed in, once the session answers
  if signed_in && app.inner.lock().await.user.is_none() {
    if let Ok(me) = infra::spotify::route(&Method::GET, "/me", &[], None).await {
      let mut inner = app.inner.lock().await;
      inner.user = Some(me);
      inner.premium = Some(true);
    } else if matches!(session::current().await, Err(session::Unavailable::NotPremium)) {
      app.inner.lock().await.premium = Some(false);
    }
  }
  let mut inner = app.inner.lock().await;
  if inner.pairing.as_ref().is_some_and(|p| p.expires_at < now_ms()) {
    inner.pairing = None;
    inner.error = "The code expired. Start the sign-in again.".into();
  }
  let user = inner.user.as_ref().map(|u| {
    json!({
      "id": u["id"],
      "name": u["display_name"],
      "image": u["images"][0]["url"].as_str().unwrap_or(""),
    })
  });
  Json(json!({
    "signedIn": signed_in,
    "user": if signed_in { user } else { None },
    "premium": inner.premium,
    "signIn": inner.pairing.as_ref().map(|p| json!({ "url": p.url, "code": p.code, "expiresAt": p.expires_at })),
    "error": inner.error,
    "speaker": {
      "name": app.name,
      "state": if signed_in || inner.speaker_state != "off" { if inner.speaker_state.is_empty() { "off" } else { inner.speaker_state } } else { "off" },
      "message": inner.speaker_message,
    },
  }))
  .into_response()
}

async fn login(State(app): State<Shared>, headers: HeaderMap) -> Response {
  if !allowed(&app, &headers) {
    return refuse();
  }
  if let Some(old) = app.inner.lock().await.pairing.take() {
    if let Some(task) = old.task {
      task.abort();
    }
  }
  let pending = match credentials::begin_login().await {
    Ok(pending) => pending,
    Err(e) => {
      let message = format!("{e:#}");
      app.inner.lock().await.error = message.clone();
      return (StatusCode::BAD_GATEWAY, Json(json!({ "error": { "status": 502, "message": message } }))).into_response();
    }
  };
  let url = pending.url().to_string();
  let code = pending.code().to_string();
  let waiting = app.clone();
  let task = tokio::spawn(async move {
    let result = match pending.finish().await {
      Ok(credentials) => log_in_any_route(&waiting, credentials).await,
      Err(e) => Err(format!("{e:#}")),
    };
    let ok = {
      let mut inner = waiting.inner.lock().await;
      inner.pairing = None;
      inner.user = None;
      match &result {
        Ok(()) => {
          inner.error.clear();
          inner.premium = Some(true);
          true
        }
        Err(message) => {
          if message == session::Unavailable::NotPremium.message() {
            inner.premium = Some(false);
          }
          inner.error = message.clone();
          false
        }
      }
    };
    if ok {
      info!("signed in");
      start_speaker(waiting).await;
    }
  });
  let mut inner = app.inner.lock().await;
  inner.error.clear();
  // Spotify lets a code wait an hour; the page says so
  inner.pairing = Some(Pairing { url: url.clone(), code: code.clone(), expires_at: now_ms() + 3_600_000, task: Some(task) });
  Json(json!({ "url": url, "code": code })).into_response()
}

/// Signs in on the kept route, and on the other one when Spotify refuses it:
/// a proxy's node may be in a country the account does not match.
async fn log_in_any_route(app: &App, credentials: librespot_core::authentication::Credentials) -> Result<(), String> {
  let first = session::log_in(credentials.clone()).await;
  if !matches!(first, Err(session::Unavailable::Offline)) || !crate::core::route::proxy_named() {
    return match first {
      Ok(()) => Ok(()),
      Err(reason) => Err(explain(reason, account_country(&credentials).await)),
    };
  }
  let was_direct = crate::core::route::direct();
  info!("sign-in refused {}: {}; trying {}", if was_direct { "directly" } else { "through the proxy" }, session::last_error(), if was_direct { "the proxy" } else { "directly" });
  crate::core::route::set(&app.cache, !was_direct);
  let second = session::log_in(credentials.clone()).await;
  match second {
    Ok(()) => Ok(()),
    Err(reason) => {
      crate::core::route::set(&app.cache, was_direct);
      Err(explain(reason, account_country(&credentials).await))
    }
  }
}

/// The account's country and plan, from the Web API with the pairing's token:
/// what to tell a reader Spotify refused for its country.
async fn account_country(credentials: &librespot_core::authentication::Credentials) -> Option<(String, String)> {
  let token = String::from_utf8(credentials.auth_data.clone()).ok()?;
  let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().ok()?;
  let me: Value = client.get("https://api.spotify.com/v1/me").bearer_auth(token).send().await.ok()?.json().await.ok()?;
  let country = me["country"].as_str()?.to_string();
  Some((country, me["product"].as_str().unwrap_or("").to_string()))
}

/// What the reader sees for a failed connect.
fn explain(reason: session::Unavailable, account: Option<(String, String)>) -> String {
  let detail = session::last_error();
  if reason == session::Unavailable::Offline && detail.contains("Travel restriction") {
    if let Some((_, product)) = account.as_ref().filter(|(_, product)| !product.is_empty() && product != "premium") {
      return format!("Spotify refused the sign-in: the account is on the {product} plan, which plays only in its own country, and this device needs Spotify Premium.");
    }
    if let Some((country, _)) = account {
      return format!("Spotify refused the sign-in: the account is from {country}, and Spotify sees this device in another country. Route Spotify through a {country} node in the Proxy panel (or turn the proxy off when you are in {country}), then sign in again.");
    }
    return "Spotify refused the sign-in from this network's country (travel restriction): the account's country and where this device connects from must match. Pick a node in the account's country in the Proxy panel, then sign in again.".into();
  }
  if reason == session::Unavailable::Offline && !detail.is_empty() {
    return format!("{}: {detail}", reason.message());
  }
  reason.message().to_string()
}

async fn cancel(State(app): State<Shared>, headers: HeaderMap) -> Response {
  if !allowed(&app, &headers) {
    return refuse();
  }
  let mut inner = app.inner.lock().await;
  if let Some(pairing) = inner.pairing.take() {
    if let Some(task) = pairing.task {
      task.abort();
    }
  }
  inner.error.clear();
  Json(json!({ "ok": true })).into_response()
}

async fn logout(State(app): State<Shared>, headers: HeaderMap) -> Response {
  if !allowed(&app, &headers) {
    return refuse();
  }
  stop_speaker(&app).await;
  session::forget().await;
  let mut inner = app.inner.lock().await;
  inner.user = None;
  inner.premium = None;
  inner.error.clear();
  Json(json!({ "ok": true })).into_response()
}

/// A Web API path, from the internal API. Failures answer the Web API's
/// error shape: {"error": {"status", "message"}}.
async fn web(State(app): State<Shared>, method: Method, headers: HeaderMap, Path(path): Path<String>, RawQuery(query): RawQuery, body: Bytes) -> Response {
  if !allowed(&app, &headers) {
    return refuse();
  }
  let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.unwrap_or_default().as_bytes()).into_owned().collect();
  let query: Vec<(&str, String)> = pairs.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
  let body: Option<Value> = if body.is_empty() { None } else { serde_json::from_slice(&body).ok() };
  match infra::spotify::route(&method, &format!("/{path}"), &query, body.as_ref()).await {
    Ok(Value::Null) => StatusCode::NO_CONTENT.into_response(),
    Ok(value) => Json(value).into_response(),
    Err(e) => {
      let (status, message) = match e.downcast_ref::<SpotifyApiError>() {
        Some(api) => (api.status.as_u16(), api.body.clone()),
        None => (502, format!("{e:#}")),
      };
      if status >= 500 {
        warn!("{method} /{path}: {message}");
      }
      let code = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
      (code, Json(json!({ "error": { "status": status, "message": message } }))).into_response()
    }
  }
}

#[tokio::main]
async fn main() -> Result<()> {
  env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("omarchy_pocket_spotify=info,spotatui_librespot=warn")).init();
  let args = args()?;
  crate::core::paths::ensure_private_dir(&args.cache)?;
  crate::core::paths::set_cache_dir(args.cache.clone());
  let key = std::env::var("OMARCHY_POCKET_SPOTIFY_KEY").context("OMARCHY_POCKET_SPOTIFY_KEY is needed")?;
  if key.len() < 16 {
    return Err(anyhow!("OMARCHY_POCKET_SPOTIFY_KEY is too short"));
  }
  crate::core::route::load(&args.cache);
  let app: Shared = Arc::new(App { key, speaker: args.speaker, cache: args.cache.clone(), name: args.name, sink: args.sink, inner: Mutex::new(Inner { speaker_state: "off", ..Default::default() }) });

  // signed in before: the speaker comes up now
  if credentials::streaming_credentials_are_cached().unwrap_or(false) {
    let app = app.clone();
    tokio::spawn(async move { start_speaker(app).await });
  }

  let router = Router::new()
    .route("/status", get(status))
    .route("/login", post(login))
    .route("/login/cancel", post(cancel))
    .route("/logout", post(logout))
    .route("/v1/{*path}", any(web))
    .with_state(app);
  let listener = tokio::net::TcpListener::bind(("127.0.0.1", args.port)).await.with_context(|| format!("127.0.0.1:{}", args.port))?;
  info!("listening on 127.0.0.1:{}", args.port);
  axum::serve(listener, router).await?;
  Ok(())
}
