# Frequently Asked Questions (FAQ)

Q: Are there plans to open-source the ranking code and more low-level data?
A: Yes we plan to be more open in the future and involve the community more, with the first release we decided to release a limited amount of data to first gather community opinions about this approach.

Q: Is there some known issues to the methodology?
A: Yes. There are several known issues:

1) Some authors are counted as two different persons. We will strive to fix those.
2) Some famous papers that are universally applicable (e.g. Adam, layer normalization) are cited across multiple domains and then scores are accumulated by the same author on multiple domains. Hence the scores on a particular domain may not reflect contribution on that exact domain.
3) There are mismatches and missed matches from DBLP, we tried our best but still cannot match all the papers. Our DBLP snapshot ends in November 2025, so references to papers published after that (e.g. NeurIPS 2025 or any 2026 venue) are not yet counted.
4) The LLM sometimes fail to return any useful references on some papers. We have done our best to remove hallucinated references, but there could still be issues.

Q: My name/affiliation is wrong, how can I fix it?
A: Please submit an issue in the GitHub repository.

Q: How are the areas and conferences selected?
A: We followed CSRankings in general. We have only limited computational resources hence are only capable to run these five areas for the current release.

Q: What are the criteria for including faculty?
A: We follow the CSRankings database.

Q: Which conferences and years are covered?
A: Data as of 9 October 2026: 79,151 ranked papers across nine conferences in five fields. Coverage varies by conference; the year filter on the site shows each conference's range.

| Conference | Field | Years ranked | Papers |
|---|---|---|---|
| AAAI | Artificial Intelligence | 2019–2026 | 17,555 |
| ICML | Machine Learning | 2021–2025 | 9,962 |
| NeurIPS | Machine Learning | 2021–2024 | 12,517 |
| CVPR | Computer Vision | 2021–2026 | 16,113 |
| ICCV | Computer Vision | 2021, 2023, 2025 (biennial) | 6,389 |
| ACL | Natural Language Processing | 2021–2026 | 6,685 |
| EMNLP | Natural Language Processing | 2021–2025 | 5,707 |
| SIGIR | The Web & Information Retrieval | 2019–2025 (2019 partial) | 2,730 |
| The Web Conference (WWW) | The Web & Information Retrieval | 2019–2020, 2023–2025 (2020 partial) | 1,493 |

Q: What is on the way?
A:

- NeurIPS 2025, ICML 2026 — next release
- IJCAI 2019–2026 — next release (held back for a reference-parsing fix)
- SIGIR 2026, WWW 2021–2022, WWW 2026 — being collected
- 2019–2020 for the remaining conferences — planned
- EMNLP 2026, NeurIPS 2026 — when published

Q: What does the Impact Score mean?
A: Each paper we rank names its five most influential references, and the authors of those references share one point per paper (split equally among them, then normalised within each conference year). An institution's field score is the sum over its faculty. Each field is then rescaled so that its scores add up to 500 across all institutions on the tab, so that the five fields weigh equally no matter how many conferences or years they contain; the Impact Score is the sum of the five field scores. Filters re-sum only the kept conference years, using the same scale, so a filtered score is always a part of the full one.
