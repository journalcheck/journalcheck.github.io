# journalcheck.github.io

The website of **JournalCheck**, an explainable checker for predatory and hijacked journals: <https://journalcheck.github.io/>

Code, dataset and results: <https://github.com/journalcheck/journalcheck>. This repository holds the published copy of the site; its source is the `docs/` folder there, rebuilt with `python scripts/build_site.py`.

## Where to submit (beta)

`submit.html` suggests journals and computer-science conferences for a paper. Give it a PDF, or a title and abstract. Everything runs in the browser: the PDF is read on your device, and only the title, abstract and keywords go to [OpenAlex](https://openalex.org).

- **Fit:** the 50 published papers closest in meaning to yours, the share of each venue's recent output that matches your keywords, and how far its topics overlap your paper's subject.
- **Safety:** every journal goes through JournalCheck's registry rules. High-risk journals are removed; sudden output jumps and a thin track record are flagged.
- **Conferences:** deadlines, ranks and acceptance rates come from [ccfddl](https://github.com/ccfddl/ccf-deadlines) (MIT), rebuilt every Monday by `.github/workflows/refresh-conferences.yml` with `tools/build_conferences.py`, plus a hand-checked list of conferences in India (`data/conferences_extra.json`).
- **Evaluation:** 50 papers from 2025, each run with itself hidden from the search. The real conference was in the top 10 for 9 of 10 conference papers, and the real journal for 16 of 40 journal papers. Method, tooling and results are in [`eval/`](eval/).

It needs no server and no account. On a shared network, such as a campus, add a free OpenAlex API key under *Options*, because everyone on the network shares one small daily allowance.
