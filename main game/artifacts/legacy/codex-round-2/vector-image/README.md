# Reverted inspector vector-image experiment

The runtime source has been restored to checkpoint `cd0f65799c4730e0b7210353635bfc516a7cf079` for this experiment. `experiment.patch.gz` preserves the compressed reproducible patch for the proposed change; it is not part of the current app.

The experiment put static inspector heraldry in isolated SVG image documents to reduce host SVG descendants during panel replacement. Founding and the overview crest stayed inline. This used the same vector paths, fills, opacity, outline clip and charge fimbriation, with no rasterization or new artwork.

`image-verification.json` records 144 exact pixel comparisons against the original React SVG at two sizes, first-animation-frame readiness, unchanged intrinsic dimensions and accessible names at 1280×720 and 844×390. Two pure vector-document/cache tests also passed. An initial verification-script serialization failure is preserved separately in `image-verification-harness-failure.json`.

The production navigation trace did not establish a material gain:

| Unthrottled case | Script mean | Script p95 | CPU-profile time/frame | Page long tasks |
| --- | ---: | ---: | ---: | ---: |
| Cold | 4.91 ms | 15.49 ms | 3.30 ms | 0 |
| Repeated | 5.03 ms | 21.60 ms | 3.34 ms | 0 |

Cold navigation improved over the prior quiet observation, while repeated navigation and CPU cost regressed. Raw events retain genuine input work and some off-CPU waits. Four-times CPU throttling remained over budget. The experiment was therefore reverted; it does not support a performance pass or quality score. These SwiftShader measurements do not certify physical GPU or headset performance.
