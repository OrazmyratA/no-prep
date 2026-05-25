use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use napi_derive::napi;
use rsa::pkcs1v15::{Signature, VerifyingKey};
use rsa::pkcs8::DecodePublicKey;
use rsa::signature::Verifier;
use rsa::RsaPublicKey;
use sha2::{Digest, Sha256};
use std::convert::TryFrom;
use std::time::{SystemTime, UNIX_EPOCH};

const PUBLIC_KEY_PEM: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwhznsvky8/6yz5K43wU4
S/+RHXk5juHQMKdNCUX+iuYE/30+6lj6sNLG14g7Yw0ZyLVOJyOeXb3oVzS0+Ymk
/adIjahOXEU/mvDK4urlxO3SqI891bnDT9XvyDugMnNx1EMV2BQW9c5jKHr0MhV/
pTb6X9lRVLpOTLEpCHO2Yq7cLv1iQ0cVe54CuD8qGp0pDeU7FCaVvLQY+oDI9pmP
Tri1qZhz3/d8xHgU2yjx1ZsC+z5PnUFYkriykC4+rFc9i3CmpPkGWE9YQHZ/f13a
teZIdwakx0IzA0uU1H2tjrwL6liJ/FeoThSepClpnmG2Uj3c6knSa8e2x73VMaI9
XwIDAQAB
-----END PUBLIC KEY-----"#;

const FEATURE_KEY_SEED: &str = "no-prep-premium-feature-key-v1";

#[napi(js_name = "create_fingerprint")]
pub fn create_fingerprint(machine: String, host: String, platform: String) -> String {
  let payload = format!("{machine}|{host}|{platform}");
  hex::encode(Sha256::digest(payload.as_bytes()))
}

#[napi(js_name = "validate_license_signature")]
pub fn validate_license_signature(
  machine_id: String,
  expiry: i64,
  nonce: String,
  signature: String,
  expected_machine: String,
) -> bool {
  validate_license(&machine_id, expiry, &nonce, &signature, &expected_machine)
}

#[napi(js_name = "approve_feature_unlock")]
pub fn approve_feature_unlock(
  feature_name: String,
  machine_id: String,
  expiry: i64,
  nonce: String,
  signature: String,
  expected_machine: String,
) -> Option<String> {
  if !is_allowed_feature(&feature_name) {
    return None;
  }

  if !validate_license(&machine_id, expiry, &nonce, &signature, &expected_machine) {
    return None;
  }

  let key_material = format!("{FEATURE_KEY_SEED}|{feature_name}");
  Some(hex::encode(Sha256::digest(key_material.as_bytes())))
}

fn validate_license(
  machine_id: &str,
  expiry: i64,
  nonce: &str,
  signature: &str,
  expected_machine: &str,
) -> bool {
  if machine_id.is_empty() || nonce.is_empty() || machine_id != expected_machine {
    return false;
  }

  let now_ms = match SystemTime::now().duration_since(UNIX_EPOCH) {
    Ok(duration) => duration.as_millis() as i64,
    Err(_) => return false,
  };
  if expiry <= 0 || now_ms > expiry {
    return false;
  }

  let public_key = match RsaPublicKey::from_public_key_pem(PUBLIC_KEY_PEM) {
    Ok(key) => key,
    Err(_) => return false,
  };
  let signature_bytes = match STANDARD.decode(signature.trim()) {
    Ok(bytes) => bytes,
    Err(_) => return false,
  };
  let rsa_signature = match Signature::try_from(signature_bytes.as_slice()) {
    Ok(sig) => sig,
    Err(_) => return false,
  };

  let payload = format!("{machine_id}|{expiry}|{nonce}");
  let verifying_key = VerifyingKey::<Sha256>::new(public_key);
  verifying_key.verify(payload.as_bytes(), &rsa_signature).is_ok()
}

fn is_allowed_feature(feature_name: &str) -> bool {
  matches!(
    feature_name,
    "ai" | "export" | "editing" | "import" | "premium"
  )
}
