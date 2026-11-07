# Android release signing: what is public and what must stay private

This note describes the signing setup for Soulstash's GitHub Actions APK build. It contains no signing passwords or private key material.

## Current local key file

- File: `android/soulstash.keystore`
- Git status: ignored by `.gitignore` and not tracked. Keep it that way.
- File size: 2,734 bytes
- SHA-256 file checksum: `C647DC65203921D4AAE52F65EA8D562DF07DC4CF4A493DB7907C4D3464C44509`

This SHA-256 is a checksum of the whole keystore file. It is safe to share and can confirm that a later backup is byte-for-byte the same file. It is **not** the Android signing-certificate fingerprint and cannot be used to sign an app.

## Keep private

Never commit, publish, or paste these into chat, issues, or logs:

- `android/soulstash.keystore` itself
- A Base64 copy of that file. Base64 is reversible encoding, not encryption.
- The keystore password or key password

Anyone who gets the keystore and its passwords can sign an app as Soulstash. Keep an encrypted offline backup too; losing the key can prevent future APKs from updating the currently installed app.

## Safe to share

- The whole-file SHA-256 checksum above.
- The Android app ID: `app.soul.soulstash`.
- The signing certificate's SHA-256 fingerprint, once generated. A certificate fingerprint identifies the public certificate; it does not contain the private signing key or let someone sign an APK.
- The key alias is not itself a private key, but the workflow stores it as a secret for consistency.

The certificate fingerprint has not been recorded here. To display it locally, run this from the repository root; `keytool` prompts for the password without putting it in command history:

```powershell
keytool -list -v -keystore .\android\soulstash.keystore -alias soulstash
```

Record the `SHA256` value under a separate **Certificate SHA-256 fingerprint** heading if you want it for app-signature verification. Do not record the password.

## GitHub Actions secrets

The workflow on `main` needs these repository Actions secrets to produce a signed APK:

- `ANDROID_KEYSTORE_BASE64` — Base64 encoding of `android/soulstash.keystore` (still private; encoding does not protect it).
- `ANDROID_KEYSTORE_PASSWORD` — private.
- `ANDROID_KEY_ALIAS` — alias for the signing entry.
- `ANDROID_KEY_PASSWORD` — private.

Add them only in **Settings → Secrets and variables → Actions → New repository secret** for `ravan-001/Soulstash1`. Do not place their values in this file or in the repository. [GitHub documents that secrets are encrypted before storage and provided to a workflow at runtime](https://docs.github.com/en/actions/concepts/security/secrets), but trusted workflow code can use them. Give write access to `main` only to people you trust, and review workflow changes before merging. [GitHub also notes that log redaction is not a complete security boundary](https://docs.github.com/en/actions/concepts/security/compromised-runners).

If you do not add the secrets, the Android job intentionally stops at `Validate signing secrets` and produces no signed APK. The Windows installer job can still build independently.

## Creating the Base64 secret locally

On Windows PowerShell, this copies the Base64 value to your clipboard without printing it in the terminal. Paste it directly into the GitHub secret value field, then clear your clipboard if other people use this computer:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('.\android\soulstash.keystore')) | Set-Clipboard
```

Do not save the Base64 output as a project file or commit it.
