# Code Signing — Decision Guide

Goal: make `CodeWinOptimizer.exe` install without SmartScreen warning ("Windows protected your PC"). This requires the binary to be signed by a certificate that chains to a Microsoft-trusted root.

## TL;DR

| Option                       | Cost                 | Wait for OV / EV | SmartScreen behavior                                     |
| ---------------------------- | -------------------- | ---------------- | -------------------------------------------------------- |
| **Azure Trusted Signing**    | ~$10/month + Azure   | 1–3 days         | Clean from day 1 (Microsoft-managed)                     |
| **Sectigo / SSL.com EV**     | ~$300–$500/year      | Days–weeks       | Clean from first signed build (EV gets instant trust)    |
| **Sectigo / SSL.com OV**     | ~$80–$200/year       | Days–weeks       | Builds reputation over time (still triggers SmartScreen at first) |
| **Certum Open Source Cert**  | ~$30/year first time | Days             | Same as OV — slow reputation build                       |
| **Self-signed / unsigned**   | $0                   | —                | Always triggers SmartScreen                              |

## Recommendation

**For this project: start with Azure Trusted Signing.**

- Lowest total cost (~$120/year if usage stays low).
- No hardware token to manage (a real pain with OV/EV certs).
- Microsoft-managed cert that chains correctly out of the box.
- Onboarding is now ~1–3 days for individuals (previously locked to companies).

Switch to a Sectigo EV cert later only if Azure Trusted Signing eligibility changes or you need offline signing.

## Azure Trusted Signing — setup outline

1. Azure subscription required (free tier is fine for the signing resource itself, you pay per signing operation + monthly).
2. Create a **Trusted Signing Account** in Azure Portal.
3. Create an **Identity Validation** request (individual or organization). Wait for approval (1–3 days).
4. Create a **Certificate Profile** under the account.
5. Install `dotnet tool install --global sign` (sign CLI tool).
6. Sign on every build:
   ```powershell
   sign code trusted-signing build/bin/CodeWinOptimizer.exe `
     --trusted-signing-account <account-name> `
     --certificate-profile <profile-name>
   ```
7. Verify: `Get-AuthenticodeSignature build/bin/CodeWinOptimizer.exe` → Status `Valid`.

## Sectigo OV/EV — what you'd actually do

1. Buy from a reseller (KSoftware / SignMyCode tend to be cheapest legit sources).
2. Submit organization or individual identity docs (passport, utility bill, business registration).
3. **EV certs ship as a hardware USB token (YubiKey or eToken).** OV certs can install to the Windows cert store.
4. Wait for issuance (days).
5. Sign with `signtool sign /tr http://timestamp.sectigo.com /td sha256 /fd sha256 build/bin/CodeWinOptimizer.exe`.

**Catch with EV token:** can't be automated easily in CI (token PIN entry). People work around it with cloud HSMs (extra cost).

## What does NOT help

- Self-signed certificates: SmartScreen ignores them.
- "Open source" certs from random providers without a Microsoft-trusted chain.
- Signing with an expired or revoked cert (worse than unsigned).

## Verifying it worked

After signing and uploading the release, the fastest check:

1. Download the new `.exe` on a clean machine.
2. Right-click → Properties → there should be a **Digital Signatures** tab.
3. Launching it should NOT show "Windows protected your PC". If it does, the cert isn't chaining; rebuild or check the signing log.

## Action items when you decide

- [ ] Pick option (Azure Trusted Signing recommended).
- [ ] Apply for identity validation.
- [ ] Add signing step to the release process (manual or CI). For Azure: `sign code trusted-signing ...` after `wails build`.
- [ ] Update `scripts/publish-checksum.ps1` so the SHA256 reflects the signed binary, not the unsigned one.
