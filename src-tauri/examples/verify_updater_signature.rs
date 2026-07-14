use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs, io::Read, path::Path};

fn decode_wrapped(value: &str, label: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|error| format!("{label} is not valid base64: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("{label} is not UTF-8 minisign text: {error}"))
}

fn main() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err(
            "usage: verify_updater_signature <artifact> <signature-file> <wrapped-public-key>"
                .into(),
        );
    }

    let artifact = Path::new(&args[1]);
    let signature_path = Path::new(&args[2]);
    let public_key_text = decode_wrapped(&args[3], "updater public key")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|error| format!("invalid updater public key: {error}"))?;
    let wrapped_signature = fs::read_to_string(signature_path)
        .map_err(|error| format!("cannot read {}: {error}", signature_path.display()))?;
    let signature_text = decode_wrapped(&wrapped_signature, "updater signature")?;
    let signature = Signature::decode(&signature_text)
        .map_err(|error| format!("invalid updater signature: {error}"))?;

    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|error| format!("cannot initialize updater signature verification: {error}"))?;
    let mut file = fs::File::open(artifact)
        .map_err(|error| format!("cannot open {}: {error}", artifact.display()))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("cannot read {}: {error}", artifact.display()))?;
        if read == 0 {
            break;
        }
        verifier.update(&buffer[..read]);
    }
    verifier.finalize().map_err(|error| {
        format!(
            "{} failed updater signature verification: {error}",
            artifact.display()
        )
    })?;
    println!("verified {}", artifact.display());
    Ok(())
}
