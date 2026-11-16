# Verify release downloads

Release builds publish a `.sha256` file next to each installer and a
`build-provenance-<platform>-<architecture>.json` file containing the source
commit, tag, workflow, build-run URL, artifact sizes, and SHA256 values.

Download the installer and its matching `.sha256` file from the same GitHub
release. On macOS run `shasum -a 256 -c '<installer>.sha256'`; on Linux use
`sha256sum -c '<installer>.sha256'`. On Windows run
`Get-FileHash -Algorithm SHA256 -LiteralPath '<installer>.exe'` in PowerShell
and compare the result with the first field in the sidecar file.

A matching checksum establishes that the downloaded bytes match the published
digest. It does not establish Authenticode signing or macOS notarization. Inspect
Windows signing separately with
`Get-AuthenticodeSignature -LiteralPath '<installer>.exe'`.

## Historical v3.3.0 Windows installer

The [GitHub release API](https://api.github.com/repos/OpenCoworkAI/open-cowork/releases/tags/v3.3.0)
reports the following digest for the official
`Open.Cowork-3.3.0-win-x64.exe` asset (127,602,372 bytes):

```text
cc6ea7910af24e73579ed17cddffc4f4e32f2586bc85a8b1303de70daf9b6645
```

This matches the value reported in [issue #204](https://github.com/OpenCoworkAI/open-cowork/issues/204).
A maintainer confirmed in that issue that v3.3.0 was not Authenticode-signed.
Publishing checksum sidecars for future builds does not add a signature to that
historical installer. No certificate availability or signing delivery date is
promised by this change.
