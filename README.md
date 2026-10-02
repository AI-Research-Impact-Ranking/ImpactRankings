# AI Research Impact Rankings 

CSRankings has substantially improved university rankings in computer science by replacing subjective, reputation-based measures, such as those in US News, with more objective indicators, in particular publication counts in top conferences.

However, an important concern with CSRankings is that it can transform research assessment into a numbers game, in which higher publication counts are directly translated into higher rankings. Such incentives encourage researchers to pursue quantity rather than quality in their work.

How can we measure the quality of the publications? We believe that 1) The quality of research is best understood and evaluated by peers in the same research area; 
2) With careful and informed use, LLMs can reveal the implicit quality judgments that peers convey through their citation practices and writing across large volumes of scholarly work

Hence, we developed a new ranking system where we analyze research papers from major AI conferences. 

For each paper, we ask a large language model (Qwen2.5-7B-Instruct) what are the 5 most important papers to this paper. In other words, the five works that most strongly influence the study. By doing this, we trace which papers and authors are consistently seen as inspirational and foundational to new discoveries in the field.

We ran the model on all papers from top conferences in machine learning, computer vision, natural language processing and information retrieval from 2019 - 2026 (coverage varies by conference).

Next, we map these influential authors to their affiliated universities using the CSrankings name–affiliation database. Each time a paper is recognized as one of the “top five references” in another work, its authors and their institutions receive credit. To keep the scoring fair, points are divided by the number of co-authors, ensuring balanced recognition across collaborations.

We also rank companies in the same way. There, credit stays with the organization where the work was done: affiliations are read from the cited paper as it was published, so a paper keeps counting for the company that produced it after its authors move on.

The result is a new kind of academic ranking: one that rewards universities not just for publishing often, but for producing research that endures, inspires, and drives the field forward. This approach highlights scholarly influence and provides students, researchers, and institutions with a clearer picture of where the most impactful work is happening.

Due to computational resource limits, we were only able to run it with a small language model. It is also a project primarily led by undergraduate and master students from Oregon State University and University of California Santa Cruz. As a result, the system is very much a work in progress and will inevitably contain errors and blind spots. We actively welcome community feedback, new collaborators and contributions of GPU compute so that we can run larger LLMs, obtain more reliable results and improve the methodology.
