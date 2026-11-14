# How well does Where to submit work?

**Test:** 50 papers published in 2025, sampled at random from OpenAlex (`papers.json`): 40 journal papers, five from each of eight fields, and 10 papers from computer science conferences the tool tracks. Each paper goes through the tool exactly as a user would enter it. Its own record is removed from the search, so the tool can't simply find the paper. A **hit** means the venue the paper was actually published in appears in the tool's list.

| | Papers | Top 1 | Top 3 | Top 10 |
|---|---|---|---|---|
| All | 50 | 18% | 32% | 50% |
| Journals | 40 | 18% | 25% | 40% |
| Conferences | 10 | 20% | 60% | 90% |

By field (journals, top 10): Engineering 4/5, Physics & Astronomy 3/5, Medicine, Psychology, Social Sciences and Agricultural Sciences 2/5 each, Environmental Science 1/5, Computer Science 0/5.

**Reading this fairly.** A paper's real venue is one acceptable answer, not the only one. Most misses still returned a topically sensible list: the plant-pathology paper got *Plant Disease* and *Plant Pathology*, and the tribology paper got *Tribology International* and *Journal of Tribology*. Some real venues are unusual homes for the paper. An AI paper sat in a surgery journal, an education study in a perinatal journal, and a social-media study in a neuroscience journal, so no topic-based method would rank those.

**Where it misses.** Most journal misses are broad, many-topic journals: *Expert Systems with Applications*, *IEEE Internet of Things Journal*, *Frontiers in Environmental Science*, *Fluids*, *Children*. The ranking compares the paper's subject profile with each journal's whole output. A journal that publishes on everything matches no single paper strongly, so it falls below specialist journals. That is the next thing to fix.

**Bugs found while preparing the test (fixed):**
- The conference name matcher mapped CVPR to "Computer Vision Conference" and NeurIPS to ICONIP; 29 of 388 conferences failed to match their own name.
- Abstracts over about 1,500 characters failed outright, because of a limit in the free OpenAlex API.
- OpenAlex's per-second limit was reported as "daily allowance used up", and journals hit by it were silently dropped.
