# Tuning experiments, 16 Nov 2026

Recorded OpenAlex answers for 48 of the 50 test papers (`record.js`). Every experiment below is an offline replay of those recordings (`replay.js`), so the numbers compare like with like. The baseline replay matches the live run of 14 Nov: 15 of 39 journals in the top 10.

Missing or unusable recordings, to redo: Foods (journal), EMNLP (conference), and Expert Systems with Applications (its semantic search was not captured).

## Why journals are missed

For each journal miss, I checked whether the real journal was ever a candidate, using the per-candidate debug output (`TUNE.debug`):

| Group | Papers | What happens |
|---|---|---|
| Never found | 11 | Neither among the 50 closest papers nor in the keyword counts. Includes the venues that are odd homes for the paper (surgery, perinatal, neuroscience journals). Ranking cannot help. |
| Cut before ranking | 6 | In the keyword counts with a high share of matching output (The Crop Journal 42%, AgriEngineering 11%), but outside the 30 journals with the most matching papers. |
| Ranked out | 7 | Candidates that score below the top 10: IEEE IoT Journal, Frontiers in Environmental Science, Plant Science Today, JSTARS, Children, Crystal Growth & Design. |

The main cause is in the evidence, not the weights. Among the 50 closest papers the right journal usually has 0 or 1, so its meaning-level score is near zero. A journal with no closest papers can reach at most fit 0.5, while the 10th result scores 0.5 to 0.77. The Caution penalty from the safety screen also pushes down three of the journals. That penalty stays.

## Results (journals, 38 to 39 papers; top 1 / top 3 / top 10, mean reciprocal rank)

| Setting | Result |
|---|---|
| Baseline | 6 / 9 / 15, MRR 0.218 |
| Coverage scope (credit broad journals for a subfield once it is 5% of their output) | 6 / 10 / 15, 0.226 |
| 80 or 200 keyword candidates instead of 30 | 6 / 9 / 14, 0.212 |
| Raw matching-paper count added to the fit | 6 / 8 / 13, 0.209 |
| Grid of 96 weight combinations, best top 10 | 4 / 10 / 16, 0.190 |
| Grid, best MRR (coverage scope, share cap 0.3) | 7 / 12 / 14, 0.243 |

No setting gains more than one top-10 hit or three top-3 hits. On 39 papers that is within noise, so none is adopted.

## Next

The bottleneck is the meaning-level evidence: 50 closest papers spread over many journals. Options to test with a fresh recording:
1. A second semantic query (title and keywords only) to double the closest papers, for +$0.001 a search.
2. Fetch candidate journals in batches of 100 (`/sources?filter=openalex:S1|S2|...`, $0.0001 a call, tested), so a wider pool costs almost nothing in time.

These change the queries, so they need new recordings rather than replays.
