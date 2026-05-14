# Runbook: applying a new upstream commit

This runbook is written to be executable by an AI agent. The agent reads
the latest upstream commits, compares against `sync/changelog.md`, and
mechanically re-applies them to the fork using `sync/upstream-mapping.md`
as the contract.

## Inputs

- `UPSTREAM_REPO`: path to a fresh clone of `fgl27/smarttwitchtv`
- `BASELINE_SHA`: the SHA noted in the most recent `sync/changelog.md` entry
- `TARGET_SHA`: the upstream SHA to apply (default: upstream HEAD)

## Process

1. **Read context**
   - Read `sync/upstream-mapping.md` end to end. This is the contract.
   - Read `docs/superpowers/specs/2026-05-14-webos-port-design.md` "Foundational decisions" and "The Platform interface".

2. **Enumerate upstream commits**
   - `cd $UPSTREAM_REPO && git log --oneline $BASELINE_SHA..$TARGET_SHA -- app/`
   - For each commit, note the touched files within `app/`.

3. **For each upstream commit, in order**
   1. `git show <sha> -- app/` to see the diff.
   2. Classify each touched file:
      - File doesn't exist in fork → straight copy.
      - File exists in fork unchanged → straight apply (overwrite).
      - File exists in fork modified → 3-way merge:
        - If the upstream diff references `Android.X`, look up the corresponding `Platform.X` in `upstream-mapping.md`.
        - Rewrite the diff to use `Platform.X`.
        - Apply.
   3. If any `Android.X` in the diff has no row in `upstream-mapping.md`:
      - STOP. Surface to user: "Upstream commit <sha> references new `Android.<name>` — please decide mapping (add row, mark `pending v<X>`, or `skip`)."
      - Do not proceed with this commit until the row exists.
   4. Run the smoke tests:
      - `npm run dev` and load `http://localhost:5173/tests/platform-stubs.html` → all green.
      - `http://localhost:5173/tests/shim-proxy.html` → all green.
   5. If green, commit:
      ```
      sync(upstream): apply <short-sha> — <upstream commit subject>

      Upstream: fgl27/smarttwitchtv@<sha>
      Mapping: no new rows / N new rows added to sync/upstream-mapping.md
      ```

4. **Update changelog**
   Append entry to `sync/changelog.md` per format in that file.

5. **Report**
   Summarize: commits applied, mapping rows added, conflicts encountered.

## Stopping conditions (escalate to human)

- New `Android.X` in upstream with no clear `Platform.X` equivalent.
- Upstream restructures the bridge or directory layout (e.g., splits OSInterface.js).
- A previously-mapped `Android.X` changes signature.
- Smoke tests fail after applying a commit.
