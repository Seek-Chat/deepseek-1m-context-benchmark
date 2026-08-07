# Frozen tokenizer input

The tokenizer binary is intentionally not redistributed in this repository pending independent verification of its provenance, redistribution rights, and required notices.

Obtain `tokenizer.json` from the official DeepSeek V4 Pro model repository:

<https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/tokenizer.json>

Place it at:

```text
benchmark/tokenizer/tokenizer.json
```

Before using it, verify:

- expected bytes: `6,367,146`;
- expected SHA-256: `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`.

The checked-in `calibration.json` records only fixture hashes, answer hashes, counts, and token totals. It does not contain instantiated prompt or response bodies.
