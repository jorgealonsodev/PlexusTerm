//! Tauri commands of terminal sharing. The relay token lives only in the keyring: the frontend can
//! save it, delete it and ask whether one is saved, never read it.

use std::time::Duration;

use tauri::State;
use tauri::ipc::Channel;

use super::watch::{self, Resolved, ViewError, ViewEvent, Watches};
use super::{
    Command, ShareError, ShareEvent, ShareManager, StartRequest, TOKEN_ACCOUNT, audit, marker,
    viewer_origin,
};
use crate::secrets::{self, SharedSecrets};

fn keyring(err: secrets::SecretError) -> ShareError {
    ShareError::Keyring(err.to_string())
}

/// Starts sharing a tab; returns the share's id. Events (links, join requests, input...) arrive on
/// `on_event` until `ended`.
#[tauri::command]
pub async fn share_start(
    request: StartRequest,
    on_event: Channel<ShareEvent>,
    shares: State<'_, ShareManager>,
    secrets: State<'_, SharedSecrets>,
) -> Result<u32, ShareError> {
    let token = secrets::run(&secrets, |s| {
        if s.available() {
            s.get(TOKEN_ACCOUNT)
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(keyring)?
    .filter(|t| !t.trim().is_empty())
    .ok_or(ShareError::NoToken)?;
    shares.start(request, token, move |event| {
        let _ = on_event.send(event);
    })
}

#[tauri::command]
pub fn share_command(
    id: u32,
    command: Command,
    shares: State<'_, ShareManager>,
) -> Result<(), ShareError> {
    shares.command(id, command)
}

/// Event asking the frontend to confirm quitting while tabs are shared.
pub const QUIT_REQUESTED_EVENT: &str = "share-quit-requested";

/// The user confirmed quitting with shares: they end (viewers are told), then PlexusTerm exits.
#[tauri::command]
pub async fn share_quit(app: tauri::AppHandle, shares: State<'_, ShareManager>) -> Result<(), ()> {
    // Longer than a share takes to stop (the relay's confirmation, 5 s at most, then a tick).
    shares.stop_all(Duration::from_secs(8)).await;
    app.exit(0);
    Ok(())
}

/// The shares an earlier run left behind by crashing; reported once.
#[tauri::command]
pub fn share_crashed(shares: State<'_, ShareManager>) -> Vec<marker::Crashed> {
    shares.take_crashed()
}

/// The latest audit log entries, oldest first.
#[tauri::command]
pub fn share_audit_log(shares: State<'_, ShareManager>) -> Result<Vec<serde_json::Value>, String> {
    match shares.audit_path() {
        Some(path) => audit::read(&path).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn share_token_status(secrets: State<'_, SharedSecrets>) -> Result<bool, ShareError> {
    secrets::run(&secrets, |s| {
        Ok(s.available() && s.get(TOKEN_ACCOUNT)?.is_some_and(|t| !t.is_empty()))
    })
    .await
    .map_err(keyring)
}

#[tauri::command]
pub async fn share_token_save(
    token: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<(), ShareError> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(ShareError::NoToken);
    }
    secrets::run(&secrets, move |s| {
        s.set(TOKEN_ACCOUNT, "PlexusTerm relay token", &token)
    })
    .await
    .map_err(keyring)
}

#[tauri::command]
pub async fn share_token_delete(secrets: State<'_, SharedSecrets>) -> Result<(), ShareError> {
    secrets::run(&secrets, |s| s.delete(TOKEN_ACCOUNT))
        .await
        .map_err(keyring)
}

/// The viewer page's build hash (`GET <viewer-origin>/build.txt`), shown in the Share dialog.
#[tauri::command]
pub async fn share_build_hash(origin: String) -> Result<String, ShareError> {
    let origin = viewer_origin(&origin)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| ShareError::Unreachable(e.to_string()))?;
    let text = async {
        let response = client.get(format!("{origin}/build.txt")).send().await?;
        response.error_for_status()?.text().await
    }
    .await
    .map_err(|_| ShareError::Unreachable(origin.clone()))?;
    Ok(text.trim().chars().take(80).collect())
}

/// Where a pasted share link's share lives (its relay), read from its viewer page, for the
/// confirmation "Connect to share on <relay-host>?".
#[tauri::command]
pub async fn view_resolve(url: String) -> Result<Resolved, ViewError> {
    watch::resolve(&url).await
}

/// Opens a share in a pane after the user confirmed its relay; events arrive on `on_event`.
#[tauri::command]
pub fn view_start(
    url: String,
    relay_url: String,
    on_event: Channel<ViewEvent>,
    watches: State<'_, Watches>,
) -> Result<u32, ViewError> {
    watches.start(&url, &relay_url, move |event| {
        let _ = on_event.send(event);
    })
}

#[tauri::command]
pub fn view_input(id: u32, data: String, watches: State<'_, Watches>) -> Result<(), ViewError> {
    watches.input(id, data.as_bytes())
}

#[tauri::command]
pub fn view_close(id: u32, watches: State<'_, Watches>) {
    watches.close(id);
}
