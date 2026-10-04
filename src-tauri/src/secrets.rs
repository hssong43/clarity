//! API keys stored in the OS credential store (macOS Keychain, Windows
//! Credential Manager, Secret Service on Linux), keyed by model profile id.
//! Keys are written from the UI but never read back into it: the native HTTP
//! layer looks them up and attaches the auth header itself.

use reqwest::header::{HeaderName, HeaderValue, AUTHORIZATION};
use serde::Deserialize;

const SERVICE: &str = "app.clarity.desktop";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthScheme {
    Bearer,
    XApiKey,
    XGoogApiKey,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeyAuth {
    pub profile_id: String,
    pub scheme: AuthScheme,
}

fn entry(profile_id: &str) -> Result<keyring::Entry, String> {
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }
    keyring::Entry::new(SERVICE, profile_id).map_err(|error| error.to_string())
}

pub fn set_api_key(profile_id: &str, api_key: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is empty".to_string());
    }
    entry(profile_id)?
        .set_password(api_key)
        .map_err(|error| error.to_string())
}

pub fn delete_api_key(profile_id: &str) -> Result<(), String> {
    match entry(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn get_api_key(profile_id: &str) -> Result<String, String> {
    match entry(profile_id)?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err(
            "The API key for this profile is missing from the system keychain. Re-enter it in the profile."
                .to_string(),
        ),
        Err(error) => Err(error.to_string()),
    }
}

pub fn auth_header(scheme: AuthScheme, api_key: &str) -> Result<(HeaderName, HeaderValue), String> {
    let (name, value) = match scheme {
        AuthScheme::Bearer => (AUTHORIZATION, format!("Bearer {api_key}")),
        AuthScheme::XApiKey => (HeaderName::from_static("x-api-key"), api_key.to_string()),
        AuthScheme::XGoogApiKey => (
            HeaderName::from_static("x-goog-api-key"),
            api_key.to_string(),
        ),
    };
    let mut value = HeaderValue::from_str(&value).map_err(|_| "Invalid API key".to_string())?;
    value.set_sensitive(true);
    Ok((name, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_auth_headers_per_scheme() {
        let (name, value) = auth_header(AuthScheme::Bearer, "sk-1").unwrap();
        assert_eq!(name, AUTHORIZATION);
        assert_eq!(value, "Bearer sk-1");
        assert!(value.is_sensitive());

        let (name, value) = auth_header(AuthScheme::XApiKey, "sk-ant").unwrap();
        assert_eq!(name.as_str(), "x-api-key");
        assert_eq!(value, "sk-ant");

        let (name, value) = auth_header(AuthScheme::XGoogApiKey, "AIza").unwrap();
        assert_eq!(name.as_str(), "x-goog-api-key");
        assert_eq!(value, "AIza");
    }

    #[test]
    fn rejects_keys_that_are_not_valid_header_values() {
        assert!(auth_header(AuthScheme::XApiKey, "bad\nkey").is_err());
    }

    #[test]
    fn deserializes_auth_from_frontend_shape() {
        let auth: StoredKeyAuth =
            serde_json::from_str(r#"{"profileId":"p1","scheme":"xGoogApiKey"}"#).unwrap();
        assert_eq!(auth.profile_id, "p1");
        assert_eq!(auth.scheme, AuthScheme::XGoogApiKey);
    }

    #[test]
    fn rejects_empty_profile_ids_and_keys() {
        assert!(entry("").is_err());
        assert!(set_api_key("p1", "  ").is_err());
    }
}
