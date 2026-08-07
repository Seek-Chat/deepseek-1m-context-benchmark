# DeepSeek long-context benchmark harness

This directory is an English-only, network-free benchmark package. It freezes
the protocol, generates deterministic synthetic fixtures, produces a maximum
cost preflight, and grades captured responses. It deliberately contains no API
client and never reads credentials.

## Commands

Run commands from this directory with Python 3.11 or newer:

```powershell
python -m harness preflight
python -m harness manifest
python -m harness calibrate --check
python -m harness fixture --family single_record --tier 32k --position beginning --repeat 1 --output-dir artifacts/case
python -m harness grade --expected artifacts/case/expected.json --response response.json
python -m unittest discover -s tests -v
```

`preflight` exits nonzero if the conservative provider estimate exceeds either
the requested operator budget or the protocol's immutable USD 60 hard stop.
Use `--budget-usd` to choose a stricter operator ceiling; a value above USD 60
does not weaken the hard stop.

`fixture` writes a request payload, family-specific exact answer, and metadata for one case. It
does not send the request. Large tiers can require substantial memory and disk
space, so generate them sequentially.

`grade` accepts either a raw JSON answer or a saved OpenAI-compatible response
object. It prints an immutable grading report to standard output.

`calibrate` requires the optional `tokenizers` package and an independently
obtained `tokenizer/tokenizer.json` whose bytes and SHA-256 match the frozen
values. Install `tokenizers` in your own isolated environment before running
calibration verification; the tokenizer binary is not redistributed here. Without `--check`, the command deterministically regenerates
`calibration.json`. With `--check`, it fails on any fixture, count, or checksum
drift. The checked-in calibration covers all 144 unique fixtures representing
the 288 paired model requests.

## Paid execution boundary

Paid execution is intentionally outside this package. Before a separately
authorized adapter sends any request, it must:

1. Validate the frozen protocol and current official model IDs.
2. Verify `calibration.json` with the frozen official tokenizer checksum.
3. Reconfirm the current official prices.
4. Run this preflight with the approved budget.
5. Enforce one attempt per case and the USD 60 hard stop.
6. Store secrets only in an approved secret manager, never in fixtures or logs.

See `PROTOCOL.md` for evidence and reporting requirements.
