//! Saved SSH passwords, kept only in the system keyring (Secret Service on Linux).
//!
//! Secrets are addressed by the saved session id. They never leave the backend:
//! the frontend can only ask whether one exists, delete it, or connect with it.

use std::collections::HashMap;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

/// Keyring service under which every NexusTerm secret is stored.
pub const SERVICE: &str = "dev.nexusterm.app";

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SecretError {
    #[error("the system keyring is not available")]
    Unavailable,
    #[error("system keyring error: {message}")]
    Keyring { message: String },
}

/// Where saved passwords live. Implementations may block (D-Bus round trips),
/// so async code goes through [`run`].
pub trait SecretStore: Send + Sync {
    /// Whether the store can be used at all (e.g. a Secret Service is running).
    fn available(&self) -> bool;
    fn get(&self, id: &str) -> Result<Option<String>, SecretError>;
    /// Creates or replaces the secret of `id`; `label` is what keyring UIs show.
    fn set(&self, id: &str, label: &str, secret: &str) -> Result<(), SecretError>;
    /// Deletes the secret of `id`; deleting a missing secret succeeds.
    fn delete(&self, id: &str) -> Result<(), SecretError>;
}

pub type SharedSecrets = Arc<dyn SecretStore>;

/// Runs a store operation on the blocking pool so the async runtime never waits on D-Bus.
pub async fn run<T: Send + 'static>(
    store: &SharedSecrets,
    op: impl FnOnce(&dyn SecretStore) -> Result<T, SecretError> + Send + 'static,
) -> Result<T, SecretError> {
    let store = store.clone();
    tokio::task::spawn_blocking(move || op(&*store))
        .await
        .map_err(|err| SecretError::Keyring {
            message: err.to_string(),
        })?
}

/// A store that is never available (the default until a real one is configured).
pub struct NoStore;

impl SecretStore for NoStore {
    fn available(&self) -> bool {
        false
    }
    fn get(&self, _id: &str) -> Result<Option<String>, SecretError> {
        Ok(None)
    }
    fn set(&self, _id: &str, _label: &str, _secret: &str) -> Result<(), SecretError> {
        Err(SecretError::Unavailable)
    }
    fn delete(&self, _id: &str) -> Result<(), SecretError> {
        Ok(())
    }
}

/// The user's keyring through the Secret Service D-Bus API.
pub struct KeyringStore {
    service: String,
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::with_service(SERVICE)
    }
}

/// Maps keyring errors to messages that never carry secret bytes.
fn keyring_error(err: keyring_core::Error) -> SecretError {
    let message = match err {
        keyring_core::Error::BadEncoding(_) | keyring_core::Error::BadDataFormat(..) => {
            "the saved secret is malformed".to_string()
        }
        keyring_core::Error::Ambiguous(items) => {
            format!("{} keyring items match this session", items.len())
        }
        keyring_core::Error::NoDefaultStore => return SecretError::Unavailable,
        other => other.to_string(),
    };
    SecretError::Keyring { message }
}

impl KeyringStore {
    pub fn with_service(service: &str) -> Self {
        Self {
            service: service.to_string(),
        }
    }

    fn entry(&self, id: &str, label: Option<&str>) -> Result<keyring_core::Entry, SecretError> {
        // Installs the Secret Service store as keyring-core's default store, once.
        if keyring::Entry::store_status().is_err() {
            return Err(SecretError::Unavailable);
        }
        let entry = match label {
            Some(label) => keyring_core::Entry::new_with_modifiers(
                &self.service,
                id,
                &HashMap::from([("label", label)]),
            ),
            None => keyring_core::Entry::new(&self.service, id),
        };
        entry.map_err(keyring_error)
    }
}

impl SecretStore for KeyringStore {
    fn available(&self) -> bool {
        keyring::Entry::store_status().is_ok()
    }

    fn get(&self, id: &str) -> Result<Option<String>, SecretError> {
        match self.entry(id, None)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(err) => Err(keyring_error(err)),
        }
    }

    fn set(&self, id: &str, label: &str, secret: &str) -> Result<(), SecretError> {
        // Updated in place: deleting first could lose the old secret if the write then
        // failed. Secret Service keeps the label of an existing item, so it may show an
        // old user@host:port; editing those forgets the secret anyway, so a new item
        // (with a fresh label) is created the next time the password is saved.
        self.entry(id, Some(label))?
            .set_password(secret)
            .map_err(keyring_error)
    }

    fn delete(&self, id: &str) -> Result<(), SecretError> {
        match self.entry(id, None)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(err) => Err(keyring_error(err)),
        }
    }
}

/// In-memory store for tests; it also records labels.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore {
    entries: Mutex<HashMap<String, (String, String)>>,
}

#[cfg(test)]
impl MemoryStore {
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn label(&self, id: &str) -> Option<String> {
        self.entries
            .lock()
            .unwrap()
            .get(id)
            .map(|(label, _)| label.clone())
    }
}

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn available(&self) -> bool {
        true
    }
    fn get(&self, id: &str) -> Result<Option<String>, SecretError> {
        Ok(self
            .entries
            .lock()
            .unwrap()
            .get(id)
            .map(|(_, secret)| secret.clone()))
    }
    fn set(&self, id: &str, label: &str, secret: &str) -> Result<(), SecretError> {
        self.entries
            .lock()
            .unwrap()
            .insert(id.into(), (label.into(), secret.into()));
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), SecretError> {
        self.entries.lock().unwrap().remove(id);
        Ok(())
    }
}

/// A keyring that never answers writes until the returned sender is dropped,
/// like a locked Secret Service waiting on its unlock dialog (tests).
#[cfg(test)]
pub struct BlockingStore {
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

#[cfg(test)]
impl BlockingStore {
    pub fn new() -> (Arc<Self>, std::sync::mpsc::Sender<()>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let store = Self {
            release: Mutex::new(rx),
        };
        (Arc::new(store), tx)
    }

    fn wait(&self) -> Result<(), SecretError> {
        // Returns once the sender is dropped (or sends).
        let _ = self.release.lock().unwrap().recv();
        Err(SecretError::Keyring {
            message: "released".into(),
        })
    }
}

#[cfg(test)]
impl SecretStore for BlockingStore {
    fn available(&self) -> bool {
        true
    }
    fn get(&self, _id: &str) -> Result<Option<String>, SecretError> {
        Ok(None)
    }
    fn set(&self, _id: &str, _label: &str, _secret: &str) -> Result<(), SecretError> {
        self.wait()
    }
    fn delete(&self, _id: &str) -> Result<(), SecretError> {
        self.wait()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn run_uses_the_blocking_pool_on_a_current_thread_runtime() {
        let store: SharedSecrets = MemoryStore::shared();
        run(&store, |s| s.set("s1", "label", "pw")).await.unwrap();
        let got = run(&store, |s| s.get("s1")).await.unwrap();
        assert_eq!(got.as_deref(), Some("pw"));
        run(&store, |s| s.delete("s1")).await.unwrap();
        run(&store, |s| s.delete("s1")).await.unwrap();
        assert_eq!(run(&store, |s| s.get("s1")).await.unwrap(), None);
    }

    #[test]
    fn no_store_is_unavailable_and_never_stores() {
        assert!(!NoStore.available());
        assert!(matches!(
            NoStore.set("s1", "l", "pw"),
            Err(SecretError::Unavailable)
        ));
        assert_eq!(NoStore.get("s1").unwrap(), None);
    }

    #[test]
    fn errors_serialize_with_a_kind_tag_and_no_secret_bytes() {
        let err = keyring_error(keyring_core::Error::BadEncoding(b"hunter2".to_vec()));
        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("hunter2"), "{json}");
        assert!(json.contains(r#""kind":"keyring""#), "{json}");
    }

    /// Writes to the real keyring under a throwaway service and removes what it created.
    /// Run with `cargo test --lib -- --ignored real_keyring`.
    #[test]
    #[ignore = "touches the user's real keyring"]
    fn real_keyring_round_trip() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store = KeyringStore::with_service(&format!("dev.nexusterm.test.{nonce}"));
        assert!(store.available(), "no Secret Service on this machine");
        store.set("s1", "NexusTerm test", "pw").unwrap();
        let got = store.get("s1");
        store.delete("s1").unwrap();
        assert_eq!(got.unwrap().as_deref(), Some("pw"));
        assert_eq!(store.get("s1").unwrap(), None);
    }
}
