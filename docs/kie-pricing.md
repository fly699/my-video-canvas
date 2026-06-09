# KIE AI Model Pricing and Billing Reference

**Author:** Manus AI  
**Source:** KIE AI pricing page and its public model-pricing endpoint.  
**Fetch timestamp:** `2026-06-09T07:50:05Z`  

> This document is a point-in-time archive of KIE AI model pricing data. Pricing can change without notice, so production billing checks should always compare against the live KIE AI pricing page before financial commitment.

## Executive Summary

The crawl captured **313 pricing records** from KIE AI. The public pricing page reports the same overall segmentation: **313 total records**, including **43 chat**, **174 video**, **72 image**, and **24 music** records.[1]

| Metric | Value |
| --- | ---: |
| Total pricing records | 313 |
| Distinct root models | 82 |
| Distinct providers | 19 |
| Records with official / Fal reference price | 254 |
| Records without official / Fal reference price | 59 |
| Records with model-page links | 310 |

## Billing Semantics

KIE AI expresses model usage in **credits** and also displays an estimated **USD price** for each billing unit. The billing unit can differ by model family and modality; examples include `per million tokens`, `per second`, `per video`, `per image`, and other unit-specific variants. When an official or Fal price is available, the page also exposes a discount rate against that reference price.[1]

| Field | Meaning |
| --- | --- |
| Model & Modality | Human-readable model description, task type, resolution or variant when applicable. |
| Credits / Gen | Credit quantity and billing unit for the operation. |
| Our Price (USD) | KIE AI displayed USD price for the same billing unit. |
| Official / Fal Price (USD) | Reference price when provided by the source page. |
| Discount | Displayed discount percentage when a reference price exists. |

## Special Billing Notes

For Anthropic Claude-family rows, the pricing page states that prompt caching is supported. Cache writes for five minutes are billed at **1.25×** the base input rate, cache writes for one hour are billed at **2.0×** the base input rate, and cache-read hits are billed at **0.10×** the base input rate.[1]

For Seedance video billing rows, the page displays a special notice for video generation billing logic. The pricing records should therefore be interpreted together with the model-page instructions and the live billing UI when estimating multi-input or duration-sensitive jobs.[1]

## Distribution by Modality

| Modality | Records | Share |
| --- | ---: | ---: |
| video | 174 | 55.59% |
| image | 72 | 23.00% |
| chat | 43 | 13.74% |
| music | 24 | 7.67% |

## Top Providers by Number of Pricing Rows

| Provider | Records |
| --- | ---: |
| Google | 61 |
| Wan | 51 |
| Kling | 32 |
| OpenAI | 27 |
| Ideogram | 21 |
| Suno | 19 |
| Grok | 15 |
| Anthropic | 14 |
| ByteDance | 14 |
| Black Forest Labs | 10 |
| Other | 9 |
| Alibaba | 8 |
| Runway | 7 |
| Qwen | 6 |
| Hailuo | 6 |
| Elevenlabs | 5 |
| Topaz | 5 |
| Recraft | 2 |
| OpenAI 4o | 1 |

## Billing Units Observed

| Billing Unit | Records |
| --- | ---: |
| per video | 106 |
| per image | 65 |
| per second | 59 |
| per million tokens | 37 |
| per request | 20 |
| per vedio | 5 |
| unspecified | 5 |
| per million | 4 |
| per 1000 characters | 3 |
| per megapixel | 3 |
| per milion tokens | 1 |
| per 4 images | 1 |
| per  image | 1 |
| per 6 images | 1 |
| per upscale | 1 |
| per request  | 1 |

## Complete Pricing Table

| # | Root Model | Model & Modality | Type | Provider | Credits / Gen | Our Price | Official / Fal Price | Discount | Link |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | grok-imagine-video-1-5-preview | grok-imagine-video-1-5-preview, image-to-video, Input Image | video | Grok | 2 per image | $0.01 | N/A | N/A | [Open](https://kie.ai/grok-imagine-video-1.5) |
| 2 | grok-imagine-video-1-5-preview | grok-imagine-video-1-5-preview, image-to-video, 720p | video | Grok | 25 per second | $0.125 | $0.14 | −10.71% | [Open](https://kie.ai/grok-imagine-video-1.5) |
| 3 | grok-imagine-video-1-5-preview | grok-imagine-video-1-5-preview, image-to-video, 480p | video | Grok | 14.5 per second | $0.0725 | $0.08 | −9.38% | [Open](https://kie.ai/grok-imagine-video-1.5) |
| 4 | Claude-Opus-4-8 | Claude-Opus-4-8, chat, Output | chat | Anthropic | 2000 per milion tokens | $10 | N/A | N/A | [Open](https://kie.ai/claude-opus-4.8) |
| 5 | Claude-Opus-4-8 | Claude-Opus-4-8, chat, Input | chat | Anthropic | 400 per million tokens | $2 | N/A | N/A | [Open](https://kie.ai/claude-opus-4.8) |
| 6 | Gemini 3.5 Flash | Gemini 3.5 Flash, chat, output | chat | Google | 540 per million | $2.7 | N/A | N/A | N/A |
| 7 | Gemini 3.5 Flash | Gemini 3.5 Flash, chat, input | chat | Google | 90 per million | $0.45 | N/A | N/A | N/A |
| 8 | gemini-omni-video | gemini-omni-video, video, 6s 4k no video input | video | Google | 240 per video | $1.2 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 9 | gemini-omni-video | gemini-omni-video, video, 4k with video input | video | Google | 360 per video | $1.8 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 10 | gemini-omni-video | gemini-omni-video, video, 1080p with video input | video | Google | 240 per video | $1.2 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 11 | gemini-omni-video | gemini-omni-video, video, 720p with video input | video | Google | 240 per video | $1.2 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 12 | gemini-omni-video | gemini-omni-video, video, 10s 4k no video input | video | Google | 300 per video | $1.5 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 13 | gemini-omni-video | gemini-omni-video, video, 8s 4k no video input | video | Google | 270 per video | $1.35 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 14 | gemini-omni-video | gemini-omni-video, video, 4s 4k no video input | video | Google | 210 per video | $1.05 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 15 | gemini-omni-video | gemini-omni-video, video, 10s 1080p no video input | video | Google | 180 per video | $0.9 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 16 | gemini-omni-video | gemini-omni-video, video, 8s 1080p no video input | video | Google | 150 per video | $0.75 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 17 | gemini-omni-video | gemini-omni-video, video, 6s 1080p no video input | video | Google | 120 per video | $0.6 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 18 | gemini-omni-video | gemini-omni-video, video, 4s 1080p no video input | video | Google | 90 per video | $0.45 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 19 | gemini-omni-video | gemini-omni-video, video, 10s 720p no video input | video | Google | 180 per vedio | $0.9 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 20 | gemini-omni-video | gemini-omni-video, video, 8s 720p no video input | video | Google | 150 per vedio | $0.75 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 21 | gemini-omni-video | gemini-omni-video, video, 6s 720p no video input | video | Google | 120 per vedio | $0.6 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 22 | gemini-omni-video | gemini-omni-video, video, 4s 720p no video input | video | Google | 90 per vedio | $0.45 | N/A | N/A | [Open](https://kie.ai/gemini-omni) |
| 23 | Claude-Opus-4-7 | Claude-Opus-4-7, chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% | [Open](https://kie.ai/claude-opus-4-7) |
| 24 | Claude-Opus-4-7 | Claude-Opus-4-7, chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% | [Open](https://kie.ai/claude-opus-4-7) |
| 25 | HappyHorse-1.0 | HappyHorse-1.0, reference-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Freference-to-video) |
| 26 | HappyHorse-1.0 | HappyHorse-1.0, reference-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Freference-to-video) |
| 27 | HappyHorse-1.0 | HappyHorse-1.0, video-edit, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Fvideo-edit) |
| 28 | HappyHorse-1.0 | HappyHorse-1.0, video-edit, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Fvideo-edit) |
| 29 | HappyHorse-1.0 | HappyHorse-1.0, image-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Fimage-to-video) |
| 30 | HappyHorse-1.0 | HappyHorse-1.0, image-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Fimage-to-video) |
| 31 | HappyHorse-1.0 | HappyHorse-1.0, text-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Ftext-to-video) |
| 32 | HappyHorse-1.0 | HappyHorse-1.0, text-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% | [Open](https://kie.ai/happyhorse-1-0?model=happyhorse%2Ftext-to-video) |
| 33 | gpt-5.5 | gpt-5.5, Chat, Cached Input | chat | OpenAI | 28 per million tokens | $0.14 | $0.5 | −72.00% | [Open](https://kie.ai/gpt-5-5) |
| 34 | gpt-5.5 | gpt-5.5, Chat, Output | chat | OpenAI | 1680 per million tokens | $8.4 | $30 | −72.00% | [Open](https://kie.ai/gpt-5-5) |
| 35 | gpt-5.5 | gpt-5.5, Chat, Input | chat | OpenAI | 280 per million tokens | $1.4 | $5 | −72.00% | [Open](https://kie.ai/gpt-5-5) |
| 36 | gpt image 2 | gpt image 2, image-to-image, 4k | image | OpenAI | 16 per image | $0.08 | $0.413 | −80.63% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-image-to-image) |
| 37 | gpt image 2 | gpt image 2, image-to-image, 2k | image | OpenAI | 10 per image | $0.05 | $0.234 | −78.63% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-image-to-image) |
| 38 | gpt image 2 | gpt image 2, image-to-image, 1k | image | OpenAI | 6 per image | $0.03 | $0.219 | −86.30% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-image-to-image) |
| 39 | gpt image 2 | gpt image 2, text-to-image, 4k | image | OpenAI | 16 per image | $0.08 | $0.413 | −80.63% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-text-to-image) |
| 40 | gpt image 2 | gpt image 2, text-to-image, 2k | image | OpenAI | 10 per image | $0.05 | $0.234 | −78.63% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-text-to-image) |
| 41 | gpt image 2 | gpt image 2, text-to-image, 1k | image | OpenAI | 6 per image | $0.03 | $0.219 | −86.30% | [Open](https://kie.ai/gpt-image-2?model=gpt-image-2-text-to-image) |
| 42 | wan 2.7 video | wan 2.7 video, videoedit, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-videoedit) |
| 43 | wan 2.7 video | wan 2.7 video, videoedit, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-videoedit) |
| 44 | wan 2.7 video | wan 2.7 video, r2v, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-r2v) |
| 45 | wan 2.7 video | wan 2.7 video, r2v, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-r2v) |
| 46 | wan 2.7 video | wan 2.7 video, image-to-video, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-image-to-video) |
| 47 | wan 2.7 video | wan 2.7 video, image-to-video, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-image-to-video) |
| 48 | wan 2.7 video | wan 2.7 video, text-to-video, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-text-to-video) |
| 49 | wan 2.7 video | wan 2.7 video, text-to-video, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% | [Open](https://kie.ai/wan-2-7-video?model=wan%2F2-7-text-to-video) |
| 50 | Gemini 3.1 Pro- openai | Gemini 3.1 Pro- openai, chat, output | chat | Google | 700 per million | $3.5 | $12 | −70.90% | [Open](https://kie.ai/gemini-3-1-pro) |
| 51 | Gemini 3.1 Pro- openai | Gemini 3.1 Pro- openai, chat, input | chat | Google | 100 per million | $0.5 | $2 | −75.00% | [Open](https://kie.ai/gemini-3-1-pro) |
| 52 | bytedance/seedance-2 fast | bytedance/seedance-2 fast, 720p no video input | video | ByteDance | 33 per second | $0.165 | $0.2419 | −31.79% | [Open](https://kie.ai/seedance-2-0?model=bytedance%2Fseedance-2-fast) |
| 53 | bytedance/seedance-2 fast | bytedance/seedance-2 fast, 720p with video input | video | ByteDance | 20 per second | $0.10 | $0.1451 | −31.08% | [Open](https://kie.ai/seedance-2-0?model=bytedance%2Fseedance-2-fast) |
| 54 | bytedance/seedance-2 fast | bytedance/seedance-2 fast, 480p no video input | video | ByteDance | 15.5 per second | $0.0775 | $0.1125 | −31.11% | [Open](https://kie.ai/seedance-2-0?model=bytedance%2Fseedance-2-fast) |
| 55 | bytedance/seedance-2 fast | bytedance/seedance-2 fast, 480p with video input | video | ByteDance | 9 per second | $0.045 | $0.0675 | −33.33% | [Open](https://kie.ai/seedance-2-0?model=bytedance%2Fseedance-2-fast) |
| 56 | bytedance/seedance-2 | bytedance/seedance-2, 1080p with video input | video | ByteDance | 62 per second | $0.31 | $0.4082 | −24.06% | [Open](https://kie.ai/seedance-2-0) |
| 57 | bytedance/seedance-2 | bytedance/seedance-2, 1080p no video input | video | ByteDance | 102 per second | $0.51 | $0.6804 | −25.04% | N/A |
| 58 | bytedance/seedance-2 | bytedance/seedance-2, 720p no video input | video | ByteDance | 41 per second | $0.205 | $0.3024 | −32.21% | [Open](https://kie.ai/seedance-2-0) |
| 59 | bytedance/seedance-2 | bytedance/seedance-2, 720p with video input | video | ByteDance | 25 per second | $0.125 | $0.1814 | −31.09% | [Open](https://kie.ai/seedance-2-0) |
| 60 | bytedance/seedance-2 | bytedance/seedance-2, 480p no video input | video | ByteDance | 19 per second | $0.095 | $0.1406 | −32.43% | [Open](https://kie.ai/seedance-2-0) |
| 61 | bytedance/seedance-2 | bytedance/seedance-2, 480p with video input | video | ByteDance | 11.5 per second | $0.057 | $0.0844 | −32.46% | [Open](https://kie.ai/seedance-2-0) |
| 62 | wan 2.7 image pro | wan 2.7 image pro | image | Wan | 12 per image | $0.06 | $0.075 | −20.00% | [Open](https://kie.ai/wan-2-7-image?model=wan%2F2-7-image-pro) |
| 63 | wan 2.7 image | wan 2.7 image | image | Wan | 4.8 per image | $0.024 | $0.03 | −20.00% | [Open](https://kie.ai/wan-2-7-image) |
| 64 | grok-imagine/extend | grok-imagine/extend, 10s 720p | video | Grok | 30  | $0.15 | $0.8 | −81.30% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fextend) |
| 65 | grok-imagine/extend | grok-imagine/extend, 10s 480p | video | Grok | 20  | $0.1 | $0.6 | −83.40% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fextend) |
| 66 | grok-imagine/extend | grok-imagine/extend, 6s 720p | video | Grok | 20  | $0.1 | $0.48 | −79.20% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fextend) |
| 67 | grok-imagine/extend | grok-imagine/extend, 6s 480p | video | Grok | 10  | $0.05 | $0.36 | −86.20% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fextend) |
| 68 | Claude-Haiku-4-5 | Claude-Haiku-4-5, chat, Output | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% | [Open](https://kie.ai/claude-haiku-4-5) |
| 69 | Claude-Haiku-4-5 | Claude-Haiku-4-5, chat, Input | chat | Anthropic | 55 per million tokens | $0.275 | $1 | −72.50% | [Open](https://kie.ai/claude-haiku-4-5) |
| 70 | Claude-Opus-4-6 | Claude-Opus-4-6, chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% | [Open](https://kie.ai/claude-opus-4-6) |
| 71 | Claude-Opus-4-6 | Claude-Opus-4-6, chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% | [Open](https://kie.ai/claude-opus-4-6) |
| 72 | Claude-Sonnet-4-6 | Claude-Sonnet-4-6, chat, Output | chat | Anthropic | 855 per million tokens | $4.275 | $15 | −71.50% | [Open](https://kie.ai/claude-sonnet-4-6) |
| 73 | Claude-Sonnet-4-6 | Claude-Sonnet-4-6, chat, Input | chat | Anthropic | 170 per million tokens | $ 0.850 | $3 | −71.70% | [Open](https://kie.ai/claude-sonnet-4-6) |
| 74 | claude-sonnet-4-5 | claude-sonnet-4-5, Chat, Output | chat | Anthropic | 855  | $4.275 | $15 | −71.50% | [Open](https://kie.ai/claude-sonnet-4-5) |
| 75 | claude-sonnet-4-5 | claude-sonnet-4-5, Chat, Input | chat | Anthropic | 170  per million tokens | $0.850 | $3 | −71.70% | [Open](https://kie.ai/claude-sonnet-4-5) |
| 76 | claude-opus-4-5 | claude-opus-4-5, Chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% | [Open](https://kie.ai/claude-opus-4-5) |
| 77 | claude-opus-4-5 | claude-opus-4-5, Chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% | [Open](https://kie.ai/claude-opus-4-5) |
| 78 | seedream 4.5 | seedream 4.5, image-to-image | image | ByteDance | 6.5 per image | $0.0325 | $0.04 | −18.75% | [Open](https://kie.ai/seedream-4-5?model=seedream%2F4.5-edit) |
| 79 | seedream 4.5 | seedream 4.5, text-to-image | image | ByteDance | 6.5 per image | $0.0325 | $0.04 | −18.75% | [Open](https://kie.ai/seedream-4-5?model=seedream%2F4.5-text-to-image) |
| 80 | Qwen2 - Image edit | Qwen2 - Image edit, text-to-image | image | Qwen | 5.6 per image | $0.028 | $0.035 | −20.00% | [Open](https://kie.ai/qwen-image-2?model=qwen2%2Ftext-to-image) |
| 81 | Qwen2 - Image edit | Qwen2 - Image edit, image-to-image | image | Qwen | 5.6 per image | $0.028 | $0.035 | −20.00% | [Open](https://kie.ai/qwen-image-2) |
| 82 | gpt-5.4-codex | gpt-5.4-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.60 | $15 | −62.67% | [Open](https://kie.ai/codex) |
| 83 | gpt-5.4-codex | gpt-5.4-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $2.5 | −72.00% | [Open](https://kie.ai/codex) |
| 84 | gpt-5.4 | gpt-5.4, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.60 | $15 | −62.67% | [Open](https://kie.ai/gpt-5-4) |
| 85 | gpt-5.4 | gpt-5.4, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $2.5 | −72.00% | [Open](https://kie.ai/gpt-5-4) |
| 86 | kling 3.0 motion control | kling 3.0 motion control, video-to-video, 1080P | video | Kling | 27 per second | $0.135 | $0.168 | −19.64% | [Open](https://kie.ai/kling-3-motion-control) |
| 87 | kling 3.0 motion control | kling 3.0 motion control, video-to-video, 720P | video | Kling | 20 per second | $0.1 | $0.126 | −20.63% | [Open](https://kie.ai/kling-3-motion-control) |
| 88 | gpt-5-codex | gpt-5-codex, Chat, Output | chat | OpenAI | 800 per million tokens | $4.0 | $10 | −60.00% | [Open](https://kie.ai/codex) |
| 89 | gpt-5-codex | gpt-5-codex, Chat, Input | chat | OpenAI | 100 per million tokens | $0.50 | $1.25 | −60.00% | [Open](https://kie.ai/codex) |
| 90 | gpt-5.2-codex | gpt-5.2-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.6 | $14 | −60.00% | [Open](https://kie.ai/codex) |
| 91 | gpt-5.2-codex | gpt-5.2-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $1.75 | −60.00% | [Open](https://kie.ai/codex) |
| 92 | gpt-5.3-codex | gpt-5.3-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.6 | $14 | −60.00% | [Open](https://kie.ai/codex) |
| 93 | gpt-5.3-codex | gpt-5.3-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $1.75 | −60.00% | [Open](https://kie.ai/codex) |
| 94 | gpt-5.1-codex | gpt-5.1-codex, Chat, Output | chat | OpenAI | 800 per million tokens | $4.00 | $10 | −60.00% | [Open](https://kie.ai/codex) |
| 95 | gpt-5.1-codex | gpt-5.1-codex, Chat, Input | chat | OpenAI | 100 per million tokens | $0.50 | $1.25 | −60.00% | [Open](https://kie.ai/codex) |
| 96 | Google nano banana 2 | Google nano banana 2, 4K | image | Google | 18 per image | $0.09 | $0.16 | −43.75% | [Open](https://kie.ai/nano-banana-2) |
| 97 | Google nano banana 2 | Google nano banana 2, 2K | image | Google | 12 per image | $0.06 | $0.12 | −50.00% | [Open](https://kie.ai/nano-banana-2) |
| 98 | Google nano banana 2 | Google nano banana 2, 1K | image | Google | 8 per image | $0.04 | $0.08 | −50.00% | [Open](https://kie.ai/nano-banana-2) |
| 99 | gpt-5-2 | gpt-5-2, Chat, Input | chat | OpenAI | 87.5 per million tokens | $0.44 | $1.75 | −74.90% | [Open](https://kie.ai/gpt-5-2) |
| 100 | gpt-5-2 | gpt-5-2, Chat, Output | chat | OpenAI | 700 per million tokens | $3.5 | $14 | −75.00% | [Open](https://kie.ai/gpt-5-2) |
| 101 | seedream 5.0 Lite | seedream 5.0 Lite, image-to-image | image | ByteDance | 5.5 per image | $0.0275 | $0.035 | −21.43% | [Open](https://kie.ai/seedream5-0-lite?model=seedream%2F5-lite-image-to-image) |
| 102 | seedream 5.0 Lite | seedream 5.0 Lite, text-to-image | image | ByteDance | 5.5 per image | $0.0275 | $0.035 | −21.43% | [Open](https://kie.ai/seedream5-0-lite?model=seedream%2F5-lite-text-to-image) |
| 103 | Kling 3.0 | Kling 3.0, video, without audio-4K | video | Kling | 67 per second | $0.335 | $0.42 | −20.24% | [Open](https://kie.ai/kling-3-0) |
| 104 | Kling 3.0 | Kling 3.0, video, with audio-4K | video | Kling | 67 per second | $0.335 | $0.42 | −20.24% | [Open](https://kie.ai/kling-3-0) |
| 105 | Kling 3.0 | Kling 3.0, video, with audio-1080P | video | Kling | 27 per second | $0.135 | $0.168 | −19.64% | [Open](https://kie.ai/kling-3-0) |
| 106 | Kling 3.0 | Kling 3.0, video, without audio-1080P | video | Kling | 18 per second | $0.09 | $0.112 | −19.64% | [Open](https://kie.ai/kling-3-0) |
| 107 | Kling 3.0 | Kling 3.0, video, with audio-720P | video | Kling | 20 per second | $0.1 | $0.112 | −10.71% | [Open](https://kie.ai/kling-3-0) |
| 108 | Kling 3.0 | Kling 3.0, video, without audio-720P | video | Kling | 14 per second | $0.07 | $0.084 | −16.67% | [Open](https://kie.ai/kling-3-0) |
| 109 | Suno | Suno, Boost Music Style Boost | music | Suno | 0.4 per request | $0.002 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fboost-music-style) |
| 110 | Recraft Remove Background | Recraft Remove Background , image to image | image | Recraft | 1.0 per image | $0.005 | $0.01 | −50.00% | [Open](https://kie.ai/recraft-remove-background) |
| 111 | Elevenlabs V3 | Elevenlabs V3 , Text to dialogue | music | Elevenlabs | 14 per 1000 characters | $0.07 | $0.1 | −30.00% | [Open](https://kie.ai/elevenlabs/text-to-dialogue-v3) |
| 112 | Gemini 3 Flash | Gemini 3 Flash, Chat, Output | chat | Google | 180 per million tokens | $0.90 | $3 | −70.00% | [Open](https://kie.ai/gemini-3-flash) |
| 113 | Gemini 3 Flash | Gemini 3 Flash, Chat, Input | chat | Google | 30 per million tokens | $0.15 | $0.5 | −70.00% | [Open](https://kie.ai/gemini-3-flash) |
| 114 | Gemini 3 Pro | Gemini 3 Pro, Chat, Output | chat | Google | 700 per million tokens | $3.5 | $12 | −70.90% | [Open](https://kie.ai/gemini-3-pro) |
| 115 | Gemini 3 Pro | Gemini 3 Pro, Chat, Input | chat | Google | 100 per million tokens | $0.50 | $2 | −75.00% | [Open](https://kie.ai/gemini-3-pro) |
| 116 | kling 2.6 | kling 2.6, text-to-video, with audio-10.0s | video | Kling | 220.0 per video | $1.1 | $1.4 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Ftext-to-video) |
| 117 | kling 2.6 | kling 2.6, text-to-video, without audio-10.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Ftext-to-video) |
| 118 | kling 2.6 | kling 2.6, text-to-video, without audio-5.0s | video | Kling | 55.0 per video | $0.275 | $0.35 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Ftext-to-video) |
| 119 | kling 2.6 | kling 2.6, text-to-video, with audio-5.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Ftext-to-video) |
| 120 | kling 2.6 | kling 2.6, image-to-video, without audio-10.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Fimage-to-video) |
| 121 | kling 2.6 | kling 2.6, image-to-video, with audio-10.0s | video | Kling | 220.0 per video | $1.1 | $1.4 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Fimage-to-video) |
| 122 | kling 2.6 | kling 2.6, image-to-video, with audio-5.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% | [Open](https://kie.ai/kling-2-6?model=kling-2.6%2Fimage-to-video) |
| 123 | kling 2.6 | kling 2.6, image-to-video, without audio-5.0s | video | Kling | 55.0 per video | $0.275 | $0.35 | −21.43% | [Open](https://kie.ai/kling-2-6) |
| 124 | wan 2.6 | wan 2.6, video-to-video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 125 | wan 2.6 | wan 2.6, video-to-video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 126 | wan 2.6 | wan 2.6, video-to-video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 127 | wan 2.6 | wan 2.6, video-to-video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 128 | wan 2.6 | wan 2.6, video-to-video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 129 | wan 2.6 | wan 2.6, image-to-video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 130 | wan 2.6 | wan 2.6, image-to-video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 131 | wan 2.6 | wan 2.6, video-to-video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-video-to-video) |
| 132 | wan 2.6 | wan 2.6, image-to-video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 133 | wan 2.6 | wan 2.6, image-to-video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 134 | wan 2.6 | wan 2.6, image-to-video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 135 | wan 2.6 | wan 2.6, image-to-video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-image-to-video) |
| 136 | wan 2.6 | wan 2.6, text to video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 137 | wan 2.6 | wan 2.6, text to video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 138 | wan 2.6 | wan 2.6, text to video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 139 | wan 2.6 | wan 2.6, text to video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 140 | wan 2.6 | wan 2.6, text to video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 141 | wan 2.6 | wan 2.6, text to video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% | [Open](https://kie.ai/wan-2-6?model=wan%2F2-6-text-to-video) |
| 142 | Qwen z-image | Qwen z-image, text-to-image, 1.0s | image | Qwen | 0.8 per image | $0.004 | $0.005 | −20.00% | [Open](https://kie.ai/z-image) |
| 143 | Black Forest Labs Flux 2 Flex | Black Forest Labs Flux 2 Flex, text to image, 1.0s-1K | image | Black Forest Labs | 14 per image | $0.07 | $0.12 | −41.67% | [Open](https://kie.ai/flux-2?model=flux-2%2Fflex-text-to-image) |
| 144 | Black Forest Labs Flux 2 Flex | Black Forest Labs Flux 2 Flex, text to image, 1.0s-2K | image | Black Forest Labs | 24 per image | $0.12 | $0.18 | −33.33% | [Open](https://kie.ai/flux-2?model=flux-2%2Fflex-text-to-image) |
| 145 | Black Forest Labs Flux 2 Flex | Black Forest Labs Flux 2 Flex, image to image, 1.0s-2K | image | Black Forest Labs | 24.0 per image | $0.12 | $0.18 | −33.33% | [Open](https://kie.ai/flux-2?model=flux-2%2Fflex-image-to-image) |
| 146 | Black Forest Labs flux-2 pro | Black Forest Labs flux-2 pro, text-to-image, 1.0s-2K | image | Black Forest Labs | 7.0 per image | $0.035 | $0.045 | −22.22% | [Open](https://kie.ai/flux-2?model=flux-2%2Fpro-text-to-image) |
| 147 | Black Forest Labs Flux 2 Flex | Black Forest Labs Flux 2 Flex, image to image, 1.0s-1K | image | Black Forest Labs | 14.0 per image | $0.07 | $0.12 | −41.67% | [Open](https://kie.ai/flux-2?model=flux-2%2Fflex-image-to-image) |
| 148 | Black Forest Labs flux-2 pro | Black Forest Labs flux-2 pro, image to image, 1.0s-2K | image | Black Forest Labs | 7.0 per image | $0.035 | $0.045 | −22.22% | [Open](https://kie.ai/flux-2?model=flux-2%2Fpro-image-to-image) |
| 149 | Black Forest Labs flux-2 pro | Black Forest Labs flux-2 pro, text-to-image, 1.0s-1K | image | Black Forest Labs | 5.0 per image | $0.025 | $0.03 | −16.67% | [Open](https://kie.ai/flux-2?model=flux-2%2Fpro-text-to-image) |
| 150 | Black Forest Labs flux-2 pro | Black Forest Labs flux-2 pro, image to image, 1.0s-1K | image | Black Forest Labs | 5.0 per image | $0.025 | $0.03 | −16.67% | [Open](https://kie.ai/flux-2?model=flux-2%2Fpro-image-to-image) |
| 151 | Google nano banana pro | Google nano banana pro, 1/2K | image | Google | 18.0 per image | $0.09 | $0.15 | −40.00% | [Open](https://kie.ai/nano-banana-pro) |
| 152 | Google nano banana pro | Google nano banana pro, 4K | image | Google | 24.0 per image | $0.12 | $0.3 | −60.00% | [Open](https://kie.ai/nano-banana-pro) |
| 153 | grok-imagine | grok-imagine, text-to-image(quality) | image | Grok | 5 per 4 images | $0.025 | $0.05 | −50.00% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Ftext-to-image) |
| 154 | grok-imagine | grok-imagine, image-to-video, 720p | video | Grok | 3 per second | $0.015 | $0.07 | −78.57% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fimage-to-video) |
| 155 | grok-imagine | grok-imagine, text-to-video, 720p | video | Grok | 3 per second | $0.015 | $0.07 | −78.57% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Ftext-to-video) |
| 156 | grok-imagine | grok-imagine, image-to-video, 480p | video | Grok | 1.6 per second | $0.008 | $0.05 | −84.00% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fimage-to-video) |
| 157 | grok-imagine | grok-imagine, text-to-video, 480p | video | Grok | 1.6 per second | $0.008 | $0.05 | −84.00% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Ftext-to-video) |
| 158 | grok-imagine | grok-imagine, image-to-image | image | Grok | 4 per  image | $0.02 | $0.022 | −9.09% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fimage-to-image) |
| 159 | grok-imagine | grok-imagine, text-to-image | image | Grok | 4.0 per 6 images | $0.02 | $0.02 | −0.00% | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Ftext-to-video) |
| 160 | grok-imagine | grok-imagine, upscale, 360p→720p | video | Grok | 10.0 per upscale | $0.05 | N/A | N/A | [Open](https://kie.ai/grok-imagine?model=grok-imagine%2Fupscale) |
| 161 | hailuo 2.3 | hailuo 2.3, image-to-video, Pro-10.0s-768p | video | Hailuo | 90.0 per video | $0.45 | N/A | N/A | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-pro) |
| 162 | hailuo 2.3 | hailuo 2.3, image-to-video, Pro-6.0s-1080p | video | Hailuo | 80.0 per video | $0.4 | $0.49 | −18.37% | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-pro) |
| 163 | hailuo 2.3 | hailuo 2.3, image-to-video, Pro-6.0s-768p | video | Hailuo | 45.0 per video | $0.225 | N/A | N/A | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-pro) |
| 164 | hailuo 2.3 | hailuo 2.3, image-to-video, Standard-6.0s-768p | video | Hailuo | 30.0 per video | $0.15 | $0.28 | −46.43% | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-standard) |
| 165 | hailuo 2.3 | hailuo 2.3, image-to-video, Standard-10.0s-768p | video | Hailuo | 50.0 per video | $0.25 | $0.56 | −55.36% | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-standard) |
| 166 | hailuo 2.3 | hailuo 2.3, image-to-video, Standard-6.0s-1080p | video | Hailuo | 50.0 per video | $0.25 | N/A | N/A | [Open](https://kie.ai/hailuo-2-3?model=hailuo%2F2-3-image-to-video-standard) |
| 167 | Google veo 3.1 | Google veo 3.1, Extend, Lite | video | Google | 30 per vedio | $0.15 | $3.2 | −95.31% | [Open](https://kie.ai/veo-3-1?model=veo%2Fextend) |
| 168 | Google veo 3.1 | Google veo 3.1, text-to-video, Quality-4K | video | Google | 380 per video | $1.85 | $4.8 | −61.46% | [Open](https://kie.ai/veo-3-1) |
| 169 | Google veo 3.1 | Google veo 3.1, image-to-video, Quality-4K | video | Google | 370 per video | $1.85 | $4.8 | −61.46% | [Open](https://kie.ai/veo-3-1) |
| 170 | Google veo 3.1 | Google veo 3.1, text-to-video, Quality-1080p | video | Google | 255 per video | $1.275 | $3.2 | −60.16% | [Open](https://kie.ai/veo-3-1) |
| 171 | Google veo 3.1 | Google veo 3.1, image-to-video, Quality-1080p | video | Google | 255 per video | $1.275 | $3.2 | −60.16% | [Open](https://kie.ai/veo-3-1) |
| 172 | Google veo 3.1 | Google veo 3.1, text-to-video, Quality-720p | video | Google | 250 per video | $1.25 | $3.2 | −60.94% | [Open](https://kie.ai/veo-3-1) |
| 173 | Google veo 3.1 | Google veo 3.1, image-to-video, Quality-720p | video | Google | 250 per video | $1.25 | $3.2 | −60.94% | [Open](https://kie.ai/veo-3-1) |
| 174 | Google veo 3.1 | Google veo 3.1, text-to-video, Fast-4K | video | Google | 180 per video | $0.90 | $2.4 | −62.50% | [Open](https://kie.ai/veo-3-1) |
| 175 | Google veo 3.1 | Google veo 3.1, image-to-video, Fast-4K | video | Google | 180 per video | $0.90 | $2.4 | −62.50% | [Open](https://kie.ai/veo-3-1) |
| 176 | Google veo 3.1 | Google veo 3.1, text-to-video, Fast-1080p | video | Google | 65 per video | $0,325 | $1.2 | −66.10% | [Open](https://kie.ai/veo-3-1) |
| 177 | Google veo 3.1 | Google veo 3.1, image-to-video, Fast-1080p | video | Google | 65 per video | $0.325 | $1.2 | −72.92% | [Open](https://kie.ai/veo-3-1) |
| 178 | Google veo 3.1 | Google veo 3.1, text-to-video, Fast-720p | video | Google | 60 per video | $0.30 | $1.2 | −75.00% | [Open](https://kie.ai/veo-3-1) |
| 179 | Google veo 3.1 | Google veo 3.1, image-to-video, Fast-720p | video | Google | 60 per video | $0.30 | $1.2 | −75.00% | [Open](https://kie.ai/veo-3-1) |
| 180 | Google veo 3.1 | Google veo 3.1, text-to-video, Lite-4K | video | Google | 150 per video | $0.75 | N/A | N/A | [Open](https://kie.ai/veo-3-1) |
| 181 | Google veo 3.1 | Google veo 3.1, image-to-video, Lite-4K | video | Google | 150 per video | $0.15 | N/A | N/A | [Open](https://kie.ai/veo-3-1) |
| 182 | Google veo 3.1 | Google veo 3.1, text-to-video, Lite-1080p | video | Google | 35 per video | $0.175 | $0.64 | −72.66% | [Open](https://kie.ai/veo-3-1) |
| 183 | Google veo 3.1 | Google veo 3.1, image-to-video, Lite-1080p | video | Google | 35 per video | $0.175 | $0.64 | −72.66% | [Open](https://kie.ai/veo-3-1) |
| 184 | Google veo 3.1 | Google veo 3.1, text-to-video, Lite-720p | video | Google | 30 per video | $0.15 | $0.45 | −66.67% | [Open](https://kie.ai/veo-3-1) |
| 185 | Google veo 3.1 | Google veo 3.1, image-to-video, Lite-720p | video | Google | 30 per video | $0.15 | $0.45 | −66.67% | [Open](https://kie.ai/veo-3-1) |
| 186 | Google veo 3.1 | Google veo 3.1, Extend, Quality | video | Google | 250 per video | $1.25 | $2.8 | −55.36% | [Open](https://kie.ai/veo-3-1?model=veo%2Fextend) |
| 187 | Google veo 3.1 | Google veo 3.1, Extend, Fast | video | Google | 60 per video | $0.30 | $3.5 | −91.43% | [Open](https://kie.ai/veo-3-1?model=veo%2Fextend) |
| 188 | Google veo 3.1 | Google veo 3.1, Get 1080P Video | video | Google | 5 per video | $0.025 | N/A | N/A | [Open](https://kie.ai/veo-3-1?model=veo%2Fget-1080p-video) |
| 189 | Google veo 3.1 | Google veo 3.1, Get 4K Video | video | Google | 120.0 per video | $0.6 | N/A | N/A | [Open](https://docs.kie.ai/veo3-api/get-veo-3-4k-video) |
| 190 | Google veo 3.1 | Google veo 3.1, reference-to-video, Fast | video | Google | 60.0 per video | $0.3 | $1.2 | −75.00% | [Open](https://kie.ai/veo-3-1) |
| 191 | OpenAI 4o image | OpenAI 4o image, text-to-image | image | OpenAI 4o | 6.0 per image | $0.03 | N/A | N/A | [Open](https://kie.ai/4o-image-api) |
| 192 | Black Forest Labs flux1-kontext | Black Forest Labs flux1-kontext, text-to-image, Pro | image | Black Forest Labs | 5.0 per image | $0.025 | $0.08 | −68.75% | [Open](https://kie.ai/flux-kontext-api) |
| 193 | Black Forest Labs flux1-kontext | Black Forest Labs flux1-kontext, text-to-image, Max | image | Black Forest Labs | 10.0 per image | $0.05 | $0.08 | −37.50% | [Open](https://kie.ai/flux-kontext-api) |
| 194 | kling 2.5 turbo | kling 2.5 turbo , text-to-video, Turbo Pro-10.0s | video | Kling | 84.0 per video | $0.42 | $0.7 | −40.00% | [Open](https://kie.ai/kling-2-5?model=kling%2Fv2-5-turbo-text-to-video-pro) |
| 195 | kling 2.5 turbo | kling 2.5 turbo , image-to-video, Turbo Pro-5.0s | video | Kling | 42.0 per video | $0.21 | $0.35 | −40.00% | [Open](https://kie.ai/kling-2-5?model=kling%2Fv2-5-turbo-image-to-video-pro) |
| 196 | kling 2.5 turbo | kling 2.5 turbo , image-to-video, Turbo Pro-10.0s | video | Kling | 84.0 per video | $0.42 | $0.7 | −40.00% | [Open](https://kie.ai/kling-2-5?model=kling%2Fv2-5-turbo-image-to-video-pro) |
| 197 | kling 2.5 turbo | kling 2.5 turbo , text-to-video, Turbo Pro-5.0s | video | Kling | 42.0 per video | $0.21 | $0.35 | −40.00% | [Open](https://kie.ai/kling-2-5?model=kling%2Fv2-5-turbo-text-to-video-pro) |
| 198 | wan 2.5 | wan 2.5, text-to-video, default-10.0s-720p | video | Wan | 120.0 per video | $0.6 | $1.0 | −40.00% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-text-to-video) |
| 199 | wan 2.5 | wan 2.5, text-to-video, default-5.0s-1080p | video | Wan | 100.0 per video | $0.5 | $0.75 | −33.33% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-text-to-video) |
| 200 | wan 2.5 | wan 2.5, text-to-video, default-10.0s-1080p | video | Wan | 200.0 per video | $1.0 | $1.5 | −33.33% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-text-to-video) |
| 201 | wan 2.5 | wan 2.5, image-to-video, default-10.0s-1080p | video | Wan | 200.0 per video | $1.0 | $1.5 | −33.33% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-image-to-video) |
| 202 | wan 2.5 | wan 2.5, text-to-video, default-5.0s-720p | video | Wan | 60.0 per video | $0.3 | $0.5 | −40.00% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-text-to-video) |
| 203 | wan 2.5 | wan 2.5, image-to-video, default-10.0s-720p | video | Wan | 120.0 per video | $0.6 | $1.0 | −40.00% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-image-to-video) |
| 204 | wan 2.5 | wan 2.5, image-to-video, default-5.0s-1080p | video | Wan | 100.0 per video | $0.5 | $0.75 | −33.33% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-image-to-video) |
| 205 | wan 2.5 | wan 2.5, image-to-video, default-5.0s-720p | video | Wan | 60.0 per video | $0.3 | $0.5 | −40.00% | [Open](https://kie.ai/wan-2-5?model=wan%2F2-5-image-to-video) |
| 206 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Replace, 1.0s-720p | video | Wan | 12.5 per second | $0.0625 | $0.08 | −21.88% | [Open](https://kie.ai/wan-animate) |
| 207 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Replace, 1.0s-580p | video | Wan | 9.5 per second | $0.0475 | $0.06 | −20.83% | [Open](https://kie.ai/wan-animate) |
| 208 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Replace, 1.0s-480p | video | Wan | 6 per second | $0.03 | $0.04 | −25.00% | [Open](https://kie.ai/wan-animate) |
| 209 | wan 2.2 | wan 2.2, image-to-video, 5.0s-480p | video | Wan | 40 per video | $0.2 | $0.25 | −20.00% | [Open](https://kie.ai/wan/v2-2) |
| 210 | wan 2.2 | wan 2.2, image-to-video, 5.0s-720p | video | Wan | 80.0 per video | $0.4 | $0.5 | −20.00% | [Open](https://kie.ai/wan/v2-2?model=wan%2F2-2-a14b-image-to-video-turbo) |
| 211 | wan 2.2 | wan 2.2, image-to-video, 5.0s-580p | video | Wan | 60.0 per video | $0.3 | $0.375 | −20.00% | [Open](https://kie.ai/wan/v2-2?model=wan%2F2-2-a14b-image-to-video-turbo) |
| 212 | wan 2.2 | wan 2.2,  text-to-video, 5.0s-580p | video | Wan | 60.0 per video | $0.3 | $0.375 | −20.00% | [Open](https://kie.ai/wan/v2-2?model=wan%2F2-2-a14b-text-to-video-turbo) |
| 213 | wan 2.2 | wan 2.2,  text-to-video, 5.0s-480p | video | Wan | 40.0 per video | $0.2 | $0.25 | −20.00% | [Open](https://kie.ai/wan/v2-2?model=wan%2F2-2-a14b-text-to-video-turbo) |
| 214 | wan 2.2 | wan 2.2,  text-to-video, 5.0s-720p | video | Wan | 80.0 per video | $0.4 | $0.5 | −20.00% | [Open](https://kie.ai/wan/v2-2?model=wan%2F2-2-a14b-text-to-video-turbo) |
| 215 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Move, 1.0s-480p | video | Wan | 6.0 per second | $0.03 | $0.04 | −25.00% | [Open](https://kie.ai/wan-animate) |
| 216 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Move, 1.0s-580p | video | Wan | 9.5 per second | $0.0475 | $0.06 | −20.83% | [Open](https://kie.ai/wan-animate) |
| 217 | wan 2.2 Animate | wan 2.2 Animate, 2.2 Animate Move, 1.0s-720p | video | Wan | 12.5 per second | $0.0625 | $0.08 | −21.88% | [Open](https://kie.ai/wan-animate) |
| 218 | hailuo 02 | hailuo 02, text-to-video, Standard-10.0s-768p | video | Other | 50.0 per video | $0.25 | $0.45 | −44.44% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-text-to-video-standard) |
| 219 | hailuo 02 | hailuo 02, image-to-video, Standard-10.0s-512p | video | Other | 20.0 per video | $0.1 | $0.17 | −41.18% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-image-to-video-standard) |
| 220 | hailuo 02 | hailuo 02, image-to-video, Standard-10.0s-768p | video | Other | 50.0 per video | $0.25 | $0.45 | −44.44% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-image-to-video-standard) |
| 221 | hailuo 02 | hailuo 02, text-to-video, Standard-6.0s-768p | video | Other | 30.0 per video | $0.15 | $0.27 | −44.44% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-text-to-video-standard) |
| 222 | hailuo 02 | hailuo 02, image-to-video, Standard-6.0s-512p | video | Other | 12.0 per video | $0.06 | $0.102 | −41.18% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-image-to-video-standard) |
| 223 | hailuo 02 | hailuo 02, image-to-video, Pro-6.0s-1080p | video | Other | 57.0 per video | $0.285 | $0.48 | −40.62% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-image-to-video-pro) |
| 224 | hailuo 02 | hailuo 02, text-to-video, Pro-6.0s-1080p | video | Other | 57.0 per video | $0.285 | $0.48 | −40.62% | [Open](https://kie.ai/hailuo-api?model=hailuo%2F02-text-to-video-pro) |
| 225 | Topaz Video Upscaler | Topaz Video Upscaler, upscale factor 4x | video | Topaz | 14 per second | $0.07 | $0.08 | −12.50% | [Open](https://kie.ai/topaz-video-upscaler) |
| 226 | Topaz Video Upscaler | Topaz Video Upscaler, upscale factor 1x/2x | video | Topaz | 8.0 per second | $0.04 | $0.08 | −50.00% | [Open](https://kie.ai/topaz-video-upscaler) |
| 227 | Kling AI Avtar | Kling AI Avtar , lip sync, Standard-up to 15 secondss-720p | video | Kling | 8.0 per second | $0.04 | $0.0562 | −28.83% | [Open](https://kie.ai/kling-ai-avatar?model=kling%2Fv1-avatar-standard) |
| 228 | Kling AI Avtar | Kling AI Avtar , lip sync, Pro-up to 15 secondss-1080p | video | Kling | 16.0 per second | $0.08 | $0.115 | −30.43% | [Open](https://kie.ai/kling-ai-avatar?model=kling%2Fai-avatar-v1-pro) |
| 229 | MeiGen-AI InfiniteTalk | MeiGen-AI InfiniteTalk, lip sync, up to 15 secondss-480p | video | Other | 3.0 per second | $0.015 | $0.2 | −92.50% | [Open](https://kie.ai/infinitalk) |
| 230 | MeiGen-AI InfiniteTalk | MeiGen-AI InfiniteTalk, lip sync, up to 15 secondss-720p | video | Other | 12.0 per second | $0.06 | $0.4 | −85.00% | [Open](https://kie.ai/infinitalk) |
| 231 | Recraft Crisp Upscale | Recraft Crisp Upscale, image to image | image | Recraft | 0.5 per image | $0.0025 | $0.004 | −37.50% | [Open](https://kie.ai/recraft-crisp-upscale) |
| 232 | ideogram v3-remix | ideogram v3-remix, image-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-remix) |
| 233 | ideogram v3-remix | ideogram v3-remix, image-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-remix) |
| 234 | ideogram v3-edit | ideogram v3-edit, image-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-edit) |
| 235 | ideogram v3-remix | ideogram v3-remix, image-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-remix) |
| 236 | ideogram v3-edit | ideogram v3-edit, image-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-edit) |
| 237 | ideogram v3-edit | ideogram v3-edit, image-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-edit) |
| 238 | Ideogram V3 Reframe | Ideogram V3 Reframe, image to image, Quality | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% | [Open](https://kie.ai/ideogram-reframe) |
| 239 | Ideogram V3 Reframe | Ideogram V3 Reframe, image to image, Balanced | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% | [Open](https://kie.ai/ideogram-reframe) |
| 240 | Ideogram V3 Reframe | Ideogram V3 Reframe, image to image, Turbo | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% | [Open](https://kie.ai/ideogram-reframe) |
| 241 | Elevenlabs Audio Isolation | Elevenlabs Audio Isolation | music | Elevenlabs | 0.2 per second | $0.001 | $0.0016 | −37.50% | [Open](https://kie.ai/elevenlabs-audio-isolation) |
| 242 | Elevenlabs Sound Effect V2 | Elevenlabs Sound Effect V2 | music | Elevenlabs | 0.24 per second | $0.0012 | $0.002 | −40.00% | [Open](https://kie.ai/elevenlabs-sound-effect) |
| 243 | Elevenlabs Text to Speech | Elevenlabs Text to Speech, turbo 2.5 | music | Elevenlabs | 6.0 per 1000 characters | $0.03 | $0.05 | −40.00% | [Open](https://kie.ai/elevenlabs-tts?model=elevenlabs%2Ftext-to-speech-turbo-2-5) |
| 244 | Elevenlabs Text to Speech | Elevenlabs Text to Speech, multilingual v2 | music | Elevenlabs | 12.0 per 1000 characters | $0.06 | $0.1 | −40.00% | [Open](https://kie.ai/elevenlabs-tts?model=elevenlabs%2Ftext-to-speech-multilingual-v2) |
| 245 | Wan 2.2 A14B Turbo API Speech to Video | Wan 2.2 A14B Turbo API Speech to Video, 480p | video | Wan | 12.0 per second | $0.06 | $0.1 | −40.00% | [Open](https://kie.ai/wan-speech-to-video-turbo) |
| 246 | Wan 2.2 A14B Turbo API Speech to Video | Wan 2.2 A14B Turbo API Speech to Video, 720p | video | Wan | 24.0 per second | $0.12 | $0.2 | −40.00% | [Open](https://kie.ai/wan-speech-to-video-turbo) |
| 247 | Wan 2.2 A14B Turbo API Speech to Video | Wan 2.2 A14B Turbo API Speech to Video, 580p | video | Wan | 18.0 per second | $0.09 | $0.15 | −40.00% | [Open](https://kie.ai/wan-speech-to-video-turbo) |
| 248 | Qwen Image | Qwen Image , text-to-image | image | Qwen | 4.0 per megapixel | $0.02 | $0.03 | −33.33% | [Open](https://kie.ai/qwen-image) |
| 249 | Qwen Image | Qwen Image, image-to-image | image | Qwen | 4.0 per megapixel | $0.02 | N/A | N/A | [Open](https://kie.ai/qwen-image) |
| 250 | google imagen4 | google imagen4, text-to-image, Fast | image | Google | 4.0 per request | $0.02 | N/A | N/A | [Open](https://kie.ai/google/imagen4?model=google%2Fimagen4-fast) |
| 251 | google imagen4 | google imagen4, text-to-image, Ultra | image | Google | 12.0 per image | $0.06 | N/A | N/A | [Open](https://kie.ai/google/imagen4?model=google%2Fimagen4-ultra) |
| 252 | Google nano banana edit | Google nano banana edit, image-to-image | image | Google | 4.0 per image | $0.02 | $0.039 | −48.72% | [Open](https://kie.ai/nano-banana?model=google%2Fnano-banana-edit) |
| 253 | Google nano banana | Google nano banana, text-to-image | image | Google | 4.0 per image | $0.02 | $0.039 | −48.72% | [Open](https://kie.ai/nano-banana) |
| 254 | Runway Aleph | Runway Aleph | video | Runway | 110.0 per video | $0.55 | N/A | N/A | [Open](https://docs.kie.ai/runway-api/generate-aleph-video) |
| 255 | Runway | Runway, text-to-video, 5.0s-720p | video | Runway | 12.0 per video | $0.06 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 256 | Runway | Runway, text-to-video, 10.0s-720p | video | Runway | 30.0 per video | $0.15 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 257 | Runway | Runway, text-to-video, 5.0s-1080p | video | Runway | 30.0 per video | $0.15 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 258 | Runway | Runway, image-to-video, 5.0s-720p | video | Runway | 12.0 per video | $0.06 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 259 | Runway | Runway, image-to-video, 10.0s-720p | video | Runway | 30.0 per video | $0.15 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 260 | Runway | Runway, image-to-video, 5.0s-1080p | video | Runway | 30.0 per video | $0.15 | N/A | N/A | [Open](https://kie.ai/runway-api) |
| 261 | Suno | Suno, TimeStamped Lyrics | music | Suno | 0.5 per request | $0.0025 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2FtimeStamped-lyrics) |
| 262 | Suno | Suno, Cover Generate | music | Suno | 0 per request | $0 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fcover-generate) |
| 263 | Suno | Suno, Generate Persona | music | Suno | 0 per request | $0 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fgenerate-persona) |
| 264 | Suno | Suno, Generate Midi From Audio | music | Suno | 0 per request | $0 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fgenerate-midi-from-audio) |
| 265 | Suno | Suno, Generate sounds | music | Suno | 2.5 per request | $0.0125 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fsounds) |
| 266 | Suno | Suno, Mashup | music | Suno | 12 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fmashup) |
| 267 | Suno | Suno, Replace Music Section | music | Suno | 5 per request | $0.025 | N/A | N/A | [Open](https://docs.kie.ai/suno-api/replace-section) |
| 268 | Suno | Suno, Multi-Stem Separation | music | Suno | 50 per request | $0.25 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fseparate-vocals) |
| 269 | Suno | Suno, Vocal Separation | music | Suno | 10 per request | $0.05 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fseparate-vocals) |
| 270 | Suno | Suno, convert-to-wav-format | music | Suno | 0.4 per request | $0.002 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fconvert-to-wav-format) |
| 271 | Suno | Suno, Generate Lyrics | music | Suno | 0.4 per request | $0.002 | N/A | N/A | [Open](https://docs.kie.ai/suno-api/generate-lyrics) |
| 272 | Suno | Suno, upload-and-cover-audio | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fupload-and-cover-audio) |
| 273 | Suno | Suno, create-music-video | music | Suno | 2.0 per request | $0.01 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fcreate-music-video) |
| 274 | Suno | Suno, upload-and-extend-audio | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fextend) |
| 275 | Suno | Suno, add-instrumental | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fadd-instrumental) |
| 276 | Suno | Suno, Generate Music  | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api?model=ai-music-api%2Fgenerate) |
| 277 | Suno | Suno, Extend Music | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api) |
| 278 | Suno | Suno, add-vocals | music | Suno | 12.0 per request | $0.06 | N/A | N/A | [Open](https://kie.ai/suno-api) |
| 279 | Qwen image-edit | Qwen image-edit, image-to-image | image | Qwen | 5.0 per megapixel | $0.03 | $0.035 | −14.29% | [Open](https://kie.ai/qwen/image-edit) |
| 280 | ideogram character | ideogram character, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% | [Open](https://kie.ai/ideogram/character) |
| 281 | ideogram character | ideogram character, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter) |
| 282 | ideogram character-remix | ideogram character-remix, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-remix) |
| 283 | ideogram character-remix | ideogram character-remix, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-remix) |
| 284 | ideogram character | ideogram character, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter) |
| 285 | ideogram character-remix | ideogram character-remix, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-remix) |
| 286 | ideogram character-edit | ideogram character-edit, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-edit) |
| 287 | ideogram character-edit | ideogram character-edit, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-edit) |
| 288 | ideogram character-edit | ideogram character-edit, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% | [Open](https://kie.ai/ideogram/character?model=ideogram%2Fcharacter-edit) |
| 289 | Kling 2.1 | Kling 2.1, video-generation, Pro-10.0s | video | Kling | 100.0 per video | $0.5 | $0.9 | −44.44% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-pro) |
| 290 | Kling 2.1 | Kling 2.1, text-to-video, Master-5.0s | video | Kling | 160.0 per video | $0.8 | $1.4 | −42.86% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-master-text-to-video) |
| 291 | Kling 2.1 | Kling 2.1, text-to-video, Master-10.0s | video | Kling | 320.0 per video | $1.6 | $2.8 | −42.86% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-master-text-to-video) |
| 292 | Kling 2.1 | Kling 2.1, video-generation, Standard-5.0s | video | Kling | 25.0 per video | $0.125 | $0.25 | −50.00% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-standard) |
| 293 | Kling 2.1 | Kling 2.1, video-generation, Standard-10.0s | video | Kling | 50.0 per video | $0.25 | $0.5 | −50.00% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-standard) |
| 294 | Kling 2.1 | Kling 2.1, video-generation, Pro-5.0s | video | Kling | 50.0 per video | $0.25 | $0.45 | −44.44% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-pro) |
| 295 | Kling 2.1 | Kling 2.1, image-to-video, Master-5.0s | video | Kling | 160.0 per video | $0.8 | $1.4 | −42.86% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-master-image-to-video) |
| 296 | Kling 2.1 | Kling 2.1, image-to-video, Master-10.0s | video | Kling | 320.0 per video | $1.6 | $2.8 | −42.86% | [Open](https://kie.ai/kling/v2-1?model=kling%2Fv2-1-master-image-to-video) |
| 297 | ideogram v3 | ideogram v3,  text-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-text-to-image) |
| 298 | ideogram v3 | ideogram v3,  text-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-text-to-image) |
| 299 | ideogram v3 | ideogram v3,  text-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% | [Open](https://kie.ai/ideogram/v3?model=ideogram%2Fv3-text-to-image) |
| 300 | Topaz Image Upscaler | Topaz Image Upscaler, image-upscale, 8K | image | Topaz | 40.0 per image | $0.2 | $0.32 | −37.50% | [Open](https://kie.ai/topaz-image-upscale) |
| 301 | Topaz Image Upscaler | Topaz Image Upscaler, image-upscale, 4K | image | Topaz | 20.0 per image | $0.1 | $0.16 | −37.50% | [Open](https://kie.ai/topaz-image-upscale) |
| 302 | Topaz Image Upscaler | Topaz Image Upscaler, image-upscale, 2K | image | Topaz | 10.0 per image | $0.05 | $0.08 | −37.50% | [Open](https://kie.ai/topaz-image-upscale) |
| 303 | Gemini 2.5 flash | Gemini 2.5 flash, Chat, Output | chat | Google | 150 per million tokens | $0.75 | $2.50 | −70.00% | [Open](https://kie.ai/gemini-2.5-flash) |
| 304 | Gemini 2.5 flash | Gemini 2.5 flash, Chat, Input | chat | Google | 18 per million tokens | $0.09 | $0.30 | −70.00% | [Open](Gemini 2.5 flash) |
| 305 | Gemini 2.5 Pro | Gemini 2.5 Pro, Chat, Output | chat | Google | 600 per million tokens | $3.00 | $10 | −70.00% | [Open](https://kie.ai/gemini-2.5-pro) |
| 306 | Gemini 2.5 Pro | Gemini 2.5 Pro, Chat, Input | chat | Google | 76 per million tokens | $0.38 | $1.25 | −69.60% | [Open](https://kie.ai/gemini-2.5-pro) |
| 307 | kling 2.6 motion control | kling 2.6 motion control, video to video, 1080P | video | Kling | 18 per second | $0.09 | $0.112 | −19.64% | [Open](https://kie.ai/kling-2.6-motion-control) |
| 308 | kling 2.6 motion control | kling 2.6 motion control, video-to-video, 720P | video | Kling | 11 per second | $0.055 | $0.07 | −21.43% | [Open](https://kie.ai/kling-2.6-motion-control) |
| 309 | gpt image 1.5 | gpt image 1.5, image-to-image, high | image | OpenAI | 22.0 per image | $0.11 | $0.133 | −17.29% | [Open](https://kie.ai/gpt-image-1.5?model=gpt-image%2F1.5-image-to-image) |
| 310 | gpt image 1.5 | gpt image 1.5, image-to-image, medium | image | OpenAI | 4.0 per image | $0.02 | $0.034 | −41.18% | [Open](https://kie.ai/gpt-image-1.5?model=gpt-image%2F1.5-image-to-image) |
| 311 | gpt image 1.5 | gpt image 1.5, text-to-image, high | image | OpenAI | 22.0 per image | $0.11 | $0.133 | −17.29% | [Open](https://kie.ai/gpt-image-1.5?model=gpt-image%2F1.5-text-to-image) |
| 312 | gpt image 1.5 | gpt image 1.5, text-to-image, medium | image | OpenAI | 4.0 per image | $0.02 | $0.034 | −41.18% | [Open](https://kie.ai/gpt-image-1.5?model=gpt-image%2F1.5-text-to-image) |
| 313 | google imagen4 | google imagen4, text-to-image, default | image | Google | 8.0 per request | $0.04 | N/A | N/A | [Open](https://kie.ai/google/imagen4?model=google%2Fimagen4) |

## Grouped Index by Root Model

### Google veo 3.1

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Google veo 3.1, Extend, Lite | video | Google | 30 per vedio | $0.15 | $3.2 | −95.31% |
| Google veo 3.1, text-to-video, Quality-4K | video | Google | 380 per video | $1.85 | $4.8 | −61.46% |
| Google veo 3.1, image-to-video, Quality-4K | video | Google | 370 per video | $1.85 | $4.8 | −61.46% |
| Google veo 3.1, text-to-video, Quality-1080p | video | Google | 255 per video | $1.275 | $3.2 | −60.16% |
| Google veo 3.1, image-to-video, Quality-1080p | video | Google | 255 per video | $1.275 | $3.2 | −60.16% |
| Google veo 3.1, text-to-video, Quality-720p | video | Google | 250 per video | $1.25 | $3.2 | −60.94% |
| Google veo 3.1, image-to-video, Quality-720p | video | Google | 250 per video | $1.25 | $3.2 | −60.94% |
| Google veo 3.1, text-to-video, Fast-4K | video | Google | 180 per video | $0.90 | $2.4 | −62.50% |
| Google veo 3.1, image-to-video, Fast-4K | video | Google | 180 per video | $0.90 | $2.4 | −62.50% |
| Google veo 3.1, text-to-video, Fast-1080p | video | Google | 65 per video | $0,325 | $1.2 | −66.10% |
| Google veo 3.1, image-to-video, Fast-1080p | video | Google | 65 per video | $0.325 | $1.2 | −72.92% |
| Google veo 3.1, text-to-video, Fast-720p | video | Google | 60 per video | $0.30 | $1.2 | −75.00% |
| Google veo 3.1, image-to-video, Fast-720p | video | Google | 60 per video | $0.30 | $1.2 | −75.00% |
| Google veo 3.1, text-to-video, Lite-4K | video | Google | 150 per video | $0.75 | N/A | N/A |
| Google veo 3.1, image-to-video, Lite-4K | video | Google | 150 per video | $0.15 | N/A | N/A |
| Google veo 3.1, text-to-video, Lite-1080p | video | Google | 35 per video | $0.175 | $0.64 | −72.66% |
| Google veo 3.1, image-to-video, Lite-1080p | video | Google | 35 per video | $0.175 | $0.64 | −72.66% |
| Google veo 3.1, text-to-video, Lite-720p | video | Google | 30 per video | $0.15 | $0.45 | −66.67% |
| Google veo 3.1, image-to-video, Lite-720p | video | Google | 30 per video | $0.15 | $0.45 | −66.67% |
| Google veo 3.1, Extend, Quality | video | Google | 250 per video | $1.25 | $2.8 | −55.36% |
| Google veo 3.1, Extend, Fast | video | Google | 60 per video | $0.30 | $3.5 | −91.43% |
| Google veo 3.1, Get 1080P Video | video | Google | 5 per video | $0.025 | N/A | N/A |
| Google veo 3.1, Get 4K Video | video | Google | 120.0 per video | $0.6 | N/A | N/A |
| Google veo 3.1, reference-to-video, Fast | video | Google | 60.0 per video | $0.3 | $1.2 | −75.00% |

### Suno

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Suno, Boost Music Style Boost | music | Suno | 0.4 per request | $0.002 | N/A | N/A |
| Suno, TimeStamped Lyrics | music | Suno | 0.5 per request | $0.0025 | N/A | N/A |
| Suno, Cover Generate | music | Suno | 0 per request | $0 | N/A | N/A |
| Suno, Generate Persona | music | Suno | 0 per request | $0 | N/A | N/A |
| Suno, Generate Midi From Audio | music | Suno | 0 per request | $0 | N/A | N/A |
| Suno, Generate sounds | music | Suno | 2.5 per request | $0.0125 | N/A | N/A |
| Suno, Mashup | music | Suno | 12 per request | $0.06 | N/A | N/A |
| Suno, Replace Music Section | music | Suno | 5 per request | $0.025 | N/A | N/A |
| Suno, Multi-Stem Separation | music | Suno | 50 per request | $0.25 | N/A | N/A |
| Suno, Vocal Separation | music | Suno | 10 per request | $0.05 | N/A | N/A |
| Suno, convert-to-wav-format | music | Suno | 0.4 per request | $0.002 | N/A | N/A |
| Suno, Generate Lyrics | music | Suno | 0.4 per request | $0.002 | N/A | N/A |
| Suno, upload-and-cover-audio | music | Suno | 12.0 per request | $0.06 | N/A | N/A |
| Suno, create-music-video | music | Suno | 2.0 per request | $0.01 | N/A | N/A |
| Suno, upload-and-extend-audio | music | Suno | 12.0 per request | $0.06 | N/A | N/A |
| Suno, add-instrumental | music | Suno | 12.0 per request | $0.06 | N/A | N/A |
| Suno, Generate Music  | music | Suno | 12.0 per request | $0.06 | N/A | N/A |
| Suno, Extend Music | music | Suno | 12.0 per request | $0.06 | N/A | N/A |
| Suno, add-vocals | music | Suno | 12.0 per request | $0.06 | N/A | N/A |

### wan 2.6

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.6, video-to-video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% |
| wan 2.6, video-to-video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% |
| wan 2.6, video-to-video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% |
| wan 2.6, video-to-video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% |
| wan 2.6, video-to-video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% |
| wan 2.6, image-to-video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% |
| wan 2.6, image-to-video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% |
| wan 2.6, video-to-video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% |
| wan 2.6, image-to-video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% |
| wan 2.6, image-to-video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% |
| wan 2.6, image-to-video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% |
| wan 2.6, image-to-video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% |
| wan 2.6, text to video, 5.0s-1080p | video | Wan | 104.5 per video | $0.5225 | $0.75 | −30.33% |
| wan 2.6, text to video, 10.0s-1080p | video | Wan | 209.5 per video | $1.0475 | $1.5 | −30.17% |
| wan 2.6, text to video, 15.0s-1080p | video | Wan | 315.0 per video | $1.575 | $2.25 | −30.00% |
| wan 2.6, text to video, 15.0s-720p | video | Wan | 210.0 per video | $1.05 | $1.5 | −30.00% |
| wan 2.6, text to video, 10.0s-720p | video | Wan | 140.0 per video | $0.7 | $1.0 | −30.00% |
| wan 2.6, text to video, 5.0s-720p | video | Wan | 70.0 per video | $0.35 | $0.5 | −30.00% |

### gemini-omni-video

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gemini-omni-video, video, 6s 4k no video input | video | Google | 240 per video | $1.2 | N/A | N/A |
| gemini-omni-video, video, 4k with video input | video | Google | 360 per video | $1.8 | N/A | N/A |
| gemini-omni-video, video, 1080p with video input | video | Google | 240 per video | $1.2 | N/A | N/A |
| gemini-omni-video, video, 720p with video input | video | Google | 240 per video | $1.2 | N/A | N/A |
| gemini-omni-video, video, 10s 4k no video input | video | Google | 300 per video | $1.5 | N/A | N/A |
| gemini-omni-video, video, 8s 4k no video input | video | Google | 270 per video | $1.35 | N/A | N/A |
| gemini-omni-video, video, 4s 4k no video input | video | Google | 210 per video | $1.05 | N/A | N/A |
| gemini-omni-video, video, 10s 1080p no video input | video | Google | 180 per video | $0.9 | N/A | N/A |
| gemini-omni-video, video, 8s 1080p no video input | video | Google | 150 per video | $0.75 | N/A | N/A |
| gemini-omni-video, video, 6s 1080p no video input | video | Google | 120 per video | $0.6 | N/A | N/A |
| gemini-omni-video, video, 4s 1080p no video input | video | Google | 90 per video | $0.45 | N/A | N/A |
| gemini-omni-video, video, 10s 720p no video input | video | Google | 180 per vedio | $0.9 | N/A | N/A |
| gemini-omni-video, video, 8s 720p no video input | video | Google | 150 per vedio | $0.75 | N/A | N/A |
| gemini-omni-video, video, 6s 720p no video input | video | Google | 120 per vedio | $0.6 | N/A | N/A |
| gemini-omni-video, video, 4s 720p no video input | video | Google | 90 per vedio | $0.45 | N/A | N/A |

### HappyHorse-1.0

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| HappyHorse-1.0, reference-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% |
| HappyHorse-1.0, reference-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% |
| HappyHorse-1.0, video-edit, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% |
| HappyHorse-1.0, video-edit, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% |
| HappyHorse-1.0, image-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% |
| HappyHorse-1.0, image-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% |
| HappyHorse-1.0, text-to-video, 1080p | video | Alibaba | 48 per second | $0.24 | $0.28 | −14.29% |
| HappyHorse-1.0, text-to-video, 720p | video | Alibaba | 28 per second | $0.14 | $0.14 | −0.00% |

### wan 2.7 video

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.7 video, videoedit, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% |
| wan 2.7 video, videoedit, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% |
| wan 2.7 video, r2v, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% |
| wan 2.7 video, r2v, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% |
| wan 2.7 video, image-to-video, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% |
| wan 2.7 video, image-to-video, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% |
| wan 2.7 video, text-to-video, 1080p | video | Wan | 24 per second | $0.12 | $0.15 | −20.00% |
| wan 2.7 video, text-to-video, 720p | video | Wan | 16 per second | $0.08 | $0.1 | −20.00% |

### kling 2.6

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| kling 2.6, text-to-video, with audio-10.0s | video | Kling | 220.0 per video | $1.1 | $1.4 | −21.43% |
| kling 2.6, text-to-video, without audio-10.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% |
| kling 2.6, text-to-video, without audio-5.0s | video | Kling | 55.0 per video | $0.275 | $0.35 | −21.43% |
| kling 2.6, text-to-video, with audio-5.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% |
| kling 2.6, image-to-video, without audio-10.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% |
| kling 2.6, image-to-video, with audio-10.0s | video | Kling | 220.0 per video | $1.1 | $1.4 | −21.43% |
| kling 2.6, image-to-video, with audio-5.0s | video | Kling | 110.0 per video | $0.55 | $0.7 | −21.43% |
| kling 2.6, image-to-video, without audio-5.0s | video | Kling | 55.0 per video | $0.275 | $0.35 | −21.43% |

### grok-imagine

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| grok-imagine, text-to-image(quality) | image | Grok | 5 per 4 images | $0.025 | $0.05 | −50.00% |
| grok-imagine, image-to-video, 720p | video | Grok | 3 per second | $0.015 | $0.07 | −78.57% |
| grok-imagine, text-to-video, 720p | video | Grok | 3 per second | $0.015 | $0.07 | −78.57% |
| grok-imagine, image-to-video, 480p | video | Grok | 1.6 per second | $0.008 | $0.05 | −84.00% |
| grok-imagine, text-to-video, 480p | video | Grok | 1.6 per second | $0.008 | $0.05 | −84.00% |
| grok-imagine, image-to-image | image | Grok | 4 per  image | $0.02 | $0.022 | −9.09% |
| grok-imagine, text-to-image | image | Grok | 4.0 per 6 images | $0.02 | $0.02 | −0.00% |
| grok-imagine, upscale, 360p→720p | video | Grok | 10.0 per upscale | $0.05 | N/A | N/A |

### wan 2.5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.5, text-to-video, default-10.0s-720p | video | Wan | 120.0 per video | $0.6 | $1.0 | −40.00% |
| wan 2.5, text-to-video, default-5.0s-1080p | video | Wan | 100.0 per video | $0.5 | $0.75 | −33.33% |
| wan 2.5, text-to-video, default-10.0s-1080p | video | Wan | 200.0 per video | $1.0 | $1.5 | −33.33% |
| wan 2.5, image-to-video, default-10.0s-1080p | video | Wan | 200.0 per video | $1.0 | $1.5 | −33.33% |
| wan 2.5, text-to-video, default-5.0s-720p | video | Wan | 60.0 per video | $0.3 | $0.5 | −40.00% |
| wan 2.5, image-to-video, default-10.0s-720p | video | Wan | 120.0 per video | $0.6 | $1.0 | −40.00% |
| wan 2.5, image-to-video, default-5.0s-1080p | video | Wan | 100.0 per video | $0.5 | $0.75 | −33.33% |
| wan 2.5, image-to-video, default-5.0s-720p | video | Wan | 60.0 per video | $0.3 | $0.5 | −40.00% |

### Kling 2.1

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Kling 2.1, video-generation, Pro-10.0s | video | Kling | 100.0 per video | $0.5 | $0.9 | −44.44% |
| Kling 2.1, text-to-video, Master-5.0s | video | Kling | 160.0 per video | $0.8 | $1.4 | −42.86% |
| Kling 2.1, text-to-video, Master-10.0s | video | Kling | 320.0 per video | $1.6 | $2.8 | −42.86% |
| Kling 2.1, video-generation, Standard-5.0s | video | Kling | 25.0 per video | $0.125 | $0.25 | −50.00% |
| Kling 2.1, video-generation, Standard-10.0s | video | Kling | 50.0 per video | $0.25 | $0.5 | −50.00% |
| Kling 2.1, video-generation, Pro-5.0s | video | Kling | 50.0 per video | $0.25 | $0.45 | −44.44% |
| Kling 2.1, image-to-video, Master-5.0s | video | Kling | 160.0 per video | $0.8 | $1.4 | −42.86% |
| Kling 2.1, image-to-video, Master-10.0s | video | Kling | 320.0 per video | $1.6 | $2.8 | −42.86% |

### hailuo 02

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| hailuo 02, text-to-video, Standard-10.0s-768p | video | Other | 50.0 per video | $0.25 | $0.45 | −44.44% |
| hailuo 02, image-to-video, Standard-10.0s-512p | video | Other | 20.0 per video | $0.1 | $0.17 | −41.18% |
| hailuo 02, image-to-video, Standard-10.0s-768p | video | Other | 50.0 per video | $0.25 | $0.45 | −44.44% |
| hailuo 02, text-to-video, Standard-6.0s-768p | video | Other | 30.0 per video | $0.15 | $0.27 | −44.44% |
| hailuo 02, image-to-video, Standard-6.0s-512p | video | Other | 12.0 per video | $0.06 | $0.102 | −41.18% |
| hailuo 02, image-to-video, Pro-6.0s-1080p | video | Other | 57.0 per video | $0.285 | $0.48 | −40.62% |
| hailuo 02, text-to-video, Pro-6.0s-1080p | video | Other | 57.0 per video | $0.285 | $0.48 | −40.62% |

### gpt image 2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt image 2, image-to-image, 4k | image | OpenAI | 16 per image | $0.08 | $0.413 | −80.63% |
| gpt image 2, image-to-image, 2k | image | OpenAI | 10 per image | $0.05 | $0.234 | −78.63% |
| gpt image 2, image-to-image, 1k | image | OpenAI | 6 per image | $0.03 | $0.219 | −86.30% |
| gpt image 2, text-to-image, 4k | image | OpenAI | 16 per image | $0.08 | $0.413 | −80.63% |
| gpt image 2, text-to-image, 2k | image | OpenAI | 10 per image | $0.05 | $0.234 | −78.63% |
| gpt image 2, text-to-image, 1k | image | OpenAI | 6 per image | $0.03 | $0.219 | −86.30% |

### bytedance/seedance-2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| bytedance/seedance-2, 1080p with video input | video | ByteDance | 62 per second | $0.31 | $0.4082 | −24.06% |
| bytedance/seedance-2, 1080p no video input | video | ByteDance | 102 per second | $0.51 | $0.6804 | −25.04% |
| bytedance/seedance-2, 720p no video input | video | ByteDance | 41 per second | $0.205 | $0.3024 | −32.21% |
| bytedance/seedance-2, 720p with video input | video | ByteDance | 25 per second | $0.125 | $0.1814 | −31.09% |
| bytedance/seedance-2, 480p no video input | video | ByteDance | 19 per second | $0.095 | $0.1406 | −32.43% |
| bytedance/seedance-2, 480p with video input | video | ByteDance | 11.5 per second | $0.057 | $0.0844 | −32.46% |

### Kling 3.0

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Kling 3.0, video, without audio-4K | video | Kling | 67 per second | $0.335 | $0.42 | −20.24% |
| Kling 3.0, video, with audio-4K | video | Kling | 67 per second | $0.335 | $0.42 | −20.24% |
| Kling 3.0, video, with audio-1080P | video | Kling | 27 per second | $0.135 | $0.168 | −19.64% |
| Kling 3.0, video, without audio-1080P | video | Kling | 18 per second | $0.09 | $0.112 | −19.64% |
| Kling 3.0, video, with audio-720P | video | Kling | 20 per second | $0.1 | $0.112 | −10.71% |
| Kling 3.0, video, without audio-720P | video | Kling | 14 per second | $0.07 | $0.084 | −16.67% |

### hailuo 2.3

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| hailuo 2.3, image-to-video, Pro-10.0s-768p | video | Hailuo | 90.0 per video | $0.45 | N/A | N/A |
| hailuo 2.3, image-to-video, Pro-6.0s-1080p | video | Hailuo | 80.0 per video | $0.4 | $0.49 | −18.37% |
| hailuo 2.3, image-to-video, Pro-6.0s-768p | video | Hailuo | 45.0 per video | $0.225 | N/A | N/A |
| hailuo 2.3, image-to-video, Standard-6.0s-768p | video | Hailuo | 30.0 per video | $0.15 | $0.28 | −46.43% |
| hailuo 2.3, image-to-video, Standard-10.0s-768p | video | Hailuo | 50.0 per video | $0.25 | $0.56 | −55.36% |
| hailuo 2.3, image-to-video, Standard-6.0s-1080p | video | Hailuo | 50.0 per video | $0.25 | N/A | N/A |

### wan 2.2 Animate

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.2 Animate, 2.2 Animate Replace, 1.0s-720p | video | Wan | 12.5 per second | $0.0625 | $0.08 | −21.88% |
| wan 2.2 Animate, 2.2 Animate Replace, 1.0s-580p | video | Wan | 9.5 per second | $0.0475 | $0.06 | −20.83% |
| wan 2.2 Animate, 2.2 Animate Replace, 1.0s-480p | video | Wan | 6 per second | $0.03 | $0.04 | −25.00% |
| wan 2.2 Animate, 2.2 Animate Move, 1.0s-480p | video | Wan | 6.0 per second | $0.03 | $0.04 | −25.00% |
| wan 2.2 Animate, 2.2 Animate Move, 1.0s-580p | video | Wan | 9.5 per second | $0.0475 | $0.06 | −20.83% |
| wan 2.2 Animate, 2.2 Animate Move, 1.0s-720p | video | Wan | 12.5 per second | $0.0625 | $0.08 | −21.88% |

### wan 2.2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.2, image-to-video, 5.0s-480p | video | Wan | 40 per video | $0.2 | $0.25 | −20.00% |
| wan 2.2, image-to-video, 5.0s-720p | video | Wan | 80.0 per video | $0.4 | $0.5 | −20.00% |
| wan 2.2, image-to-video, 5.0s-580p | video | Wan | 60.0 per video | $0.3 | $0.375 | −20.00% |
| wan 2.2,  text-to-video, 5.0s-580p | video | Wan | 60.0 per video | $0.3 | $0.375 | −20.00% |
| wan 2.2,  text-to-video, 5.0s-480p | video | Wan | 40.0 per video | $0.2 | $0.25 | −20.00% |
| wan 2.2,  text-to-video, 5.0s-720p | video | Wan | 80.0 per video | $0.4 | $0.5 | −20.00% |

### Runway

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Runway, text-to-video, 5.0s-720p | video | Runway | 12.0 per video | $0.06 | N/A | N/A |
| Runway, text-to-video, 10.0s-720p | video | Runway | 30.0 per video | $0.15 | N/A | N/A |
| Runway, text-to-video, 5.0s-1080p | video | Runway | 30.0 per video | $0.15 | N/A | N/A |
| Runway, image-to-video, 5.0s-720p | video | Runway | 12.0 per video | $0.06 | N/A | N/A |
| Runway, image-to-video, 10.0s-720p | video | Runway | 30.0 per video | $0.15 | N/A | N/A |
| Runway, image-to-video, 5.0s-1080p | video | Runway | 30.0 per video | $0.15 | N/A | N/A |

### bytedance/seedance-2 fast

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| bytedance/seedance-2 fast, 720p no video input | video | ByteDance | 33 per second | $0.165 | $0.2419 | −31.79% |
| bytedance/seedance-2 fast, 720p with video input | video | ByteDance | 20 per second | $0.10 | $0.1451 | −31.08% |
| bytedance/seedance-2 fast, 480p no video input | video | ByteDance | 15.5 per second | $0.0775 | $0.1125 | −31.11% |
| bytedance/seedance-2 fast, 480p with video input | video | ByteDance | 9 per second | $0.045 | $0.0675 | −33.33% |

### grok-imagine/extend

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| grok-imagine/extend, 10s 720p | video | Grok | 30  | $0.15 | $0.8 | −81.30% |
| grok-imagine/extend, 10s 480p | video | Grok | 20  | $0.1 | $0.6 | −83.40% |
| grok-imagine/extend, 6s 720p | video | Grok | 20  | $0.1 | $0.48 | −79.20% |
| grok-imagine/extend, 6s 480p | video | Grok | 10  | $0.05 | $0.36 | −86.20% |

### Black Forest Labs Flux 2 Flex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Black Forest Labs Flux 2 Flex, text to image, 1.0s-1K | image | Black Forest Labs | 14 per image | $0.07 | $0.12 | −41.67% |
| Black Forest Labs Flux 2 Flex, text to image, 1.0s-2K | image | Black Forest Labs | 24 per image | $0.12 | $0.18 | −33.33% |
| Black Forest Labs Flux 2 Flex, image to image, 1.0s-2K | image | Black Forest Labs | 24.0 per image | $0.12 | $0.18 | −33.33% |
| Black Forest Labs Flux 2 Flex, image to image, 1.0s-1K | image | Black Forest Labs | 14.0 per image | $0.07 | $0.12 | −41.67% |

### Black Forest Labs flux-2 pro

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Black Forest Labs flux-2 pro, text-to-image, 1.0s-2K | image | Black Forest Labs | 7.0 per image | $0.035 | $0.045 | −22.22% |
| Black Forest Labs flux-2 pro, image to image, 1.0s-2K | image | Black Forest Labs | 7.0 per image | $0.035 | $0.045 | −22.22% |
| Black Forest Labs flux-2 pro, text-to-image, 1.0s-1K | image | Black Forest Labs | 5.0 per image | $0.025 | $0.03 | −16.67% |
| Black Forest Labs flux-2 pro, image to image, 1.0s-1K | image | Black Forest Labs | 5.0 per image | $0.025 | $0.03 | −16.67% |

### kling 2.5 turbo

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| kling 2.5 turbo , text-to-video, Turbo Pro-10.0s | video | Kling | 84.0 per video | $0.42 | $0.7 | −40.00% |
| kling 2.5 turbo , image-to-video, Turbo Pro-5.0s | video | Kling | 42.0 per video | $0.21 | $0.35 | −40.00% |
| kling 2.5 turbo , image-to-video, Turbo Pro-10.0s | video | Kling | 84.0 per video | $0.42 | $0.7 | −40.00% |
| kling 2.5 turbo , text-to-video, Turbo Pro-5.0s | video | Kling | 42.0 per video | $0.21 | $0.35 | −40.00% |

### gpt image 1.5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt image 1.5, image-to-image, high | image | OpenAI | 22.0 per image | $0.11 | $0.133 | −17.29% |
| gpt image 1.5, image-to-image, medium | image | OpenAI | 4.0 per image | $0.02 | $0.034 | −41.18% |
| gpt image 1.5, text-to-image, high | image | OpenAI | 22.0 per image | $0.11 | $0.133 | −17.29% |
| gpt image 1.5, text-to-image, medium | image | OpenAI | 4.0 per image | $0.02 | $0.034 | −41.18% |

### grok-imagine-video-1-5-preview

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| grok-imagine-video-1-5-preview, image-to-video, Input Image | video | Grok | 2 per image | $0.01 | N/A | N/A |
| grok-imagine-video-1-5-preview, image-to-video, 720p | video | Grok | 25 per second | $0.125 | $0.14 | −10.71% |
| grok-imagine-video-1-5-preview, image-to-video, 480p | video | Grok | 14.5 per second | $0.0725 | $0.08 | −9.38% |

### gpt-5.5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.5, Chat, Cached Input | chat | OpenAI | 28 per million tokens | $0.14 | $0.5 | −72.00% |
| gpt-5.5, Chat, Output | chat | OpenAI | 1680 per million tokens | $8.4 | $30 | −72.00% |
| gpt-5.5, Chat, Input | chat | OpenAI | 280 per million tokens | $1.4 | $5 | −72.00% |

### Google nano banana 2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Google nano banana 2, 4K | image | Google | 18 per image | $0.09 | $0.16 | −43.75% |
| Google nano banana 2, 2K | image | Google | 12 per image | $0.06 | $0.12 | −50.00% |
| Google nano banana 2, 1K | image | Google | 8 per image | $0.04 | $0.08 | −50.00% |

### ideogram v3-remix

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram v3-remix, image-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% |
| ideogram v3-remix, image-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% |
| ideogram v3-remix, image-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% |

### ideogram v3-edit

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram v3-edit, image-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% |
| ideogram v3-edit, image-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% |
| ideogram v3-edit, image-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% |

### Ideogram V3 Reframe

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Ideogram V3 Reframe, image to image, Quality | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% |
| Ideogram V3 Reframe, image to image, Balanced | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% |
| Ideogram V3 Reframe, image to image, Turbo | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% |

### Wan 2.2 A14B Turbo API Speech to Video

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Wan 2.2 A14B Turbo API Speech to Video, 480p | video | Wan | 12.0 per second | $0.06 | $0.1 | −40.00% |
| Wan 2.2 A14B Turbo API Speech to Video, 720p | video | Wan | 24.0 per second | $0.12 | $0.2 | −40.00% |
| Wan 2.2 A14B Turbo API Speech to Video, 580p | video | Wan | 18.0 per second | $0.09 | $0.15 | −40.00% |

### google imagen4

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| google imagen4, text-to-image, Fast | image | Google | 4.0 per request | $0.02 | N/A | N/A |
| google imagen4, text-to-image, Ultra | image | Google | 12.0 per image | $0.06 | N/A | N/A |
| google imagen4, text-to-image, default | image | Google | 8.0 per request | $0.04 | N/A | N/A |

### ideogram character

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram character, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% |
| ideogram character, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% |
| ideogram character, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% |

### ideogram character-remix

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram character-remix, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% |
| ideogram character-remix, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% |
| ideogram character-remix, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% |

### ideogram character-edit

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram character-edit, image-to-image, QUALITY | image | Ideogram | 24.0 per image | $0.12 | $0.2 | −40.00% |
| ideogram character-edit, image-to-image, TURBO | image | Ideogram | 12.0 per image | $0.06 | $0.1 | −40.00% |
| ideogram character-edit, image-to-image, BALANCED | image | Ideogram | 18.0 per image | $0.09 | $0.15 | −40.00% |

### ideogram v3

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| ideogram v3,  text-to-image, QUALITY | image | Ideogram | 10.0 per image | $0.05 | $0.09 | −44.44% |
| ideogram v3,  text-to-image, TURBO | image | Ideogram | 3.5 per image | $0.0175 | $0.03 | −41.67% |
| ideogram v3,  text-to-image, BALANCED | image | Ideogram | 7.0 per image | $0.035 | $0.06 | −41.67% |

### Topaz Image Upscaler

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Topaz Image Upscaler, image-upscale, 8K | image | Topaz | 40.0 per image | $0.2 | $0.32 | −37.50% |
| Topaz Image Upscaler, image-upscale, 4K | image | Topaz | 20.0 per image | $0.1 | $0.16 | −37.50% |
| Topaz Image Upscaler, image-upscale, 2K | image | Topaz | 10.0 per image | $0.05 | $0.08 | −37.50% |

### Claude-Opus-4-8

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude-Opus-4-8, chat, Output | chat | Anthropic | 2000 per milion tokens | $10 | N/A | N/A |
| Claude-Opus-4-8, chat, Input | chat | Anthropic | 400 per million tokens | $2 | N/A | N/A |

### Gemini 3.5 Flash

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 3.5 Flash, chat, output | chat | Google | 540 per million | $2.7 | N/A | N/A |
| Gemini 3.5 Flash, chat, input | chat | Google | 90 per million | $0.45 | N/A | N/A |

### Claude-Opus-4-7

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude-Opus-4-7, chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% |
| Claude-Opus-4-7, chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% |

### Gemini 3.1 Pro- openai

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 3.1 Pro- openai, chat, output | chat | Google | 700 per million | $3.5 | $12 | −70.90% |
| Gemini 3.1 Pro- openai, chat, input | chat | Google | 100 per million | $0.5 | $2 | −75.00% |

### Claude-Haiku-4-5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude-Haiku-4-5, chat, Output | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% |
| Claude-Haiku-4-5, chat, Input | chat | Anthropic | 55 per million tokens | $0.275 | $1 | −72.50% |

### Claude-Opus-4-6

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude-Opus-4-6, chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% |
| Claude-Opus-4-6, chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% |

### Claude-Sonnet-4-6

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Claude-Sonnet-4-6, chat, Output | chat | Anthropic | 855 per million tokens | $4.275 | $15 | −71.50% |
| Claude-Sonnet-4-6, chat, Input | chat | Anthropic | 170 per million tokens | $ 0.850 | $3 | −71.70% |

### claude-sonnet-4-5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| claude-sonnet-4-5, Chat, Output | chat | Anthropic | 855  | $4.275 | $15 | −71.50% |
| claude-sonnet-4-5, Chat, Input | chat | Anthropic | 170  per million tokens | $0.850 | $3 | −71.70% |

### claude-opus-4-5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| claude-opus-4-5, Chat, Output | chat | Anthropic | 1430 per million tokens | $7.150 | $25 | −71.40% |
| claude-opus-4-5, Chat, Input | chat | Anthropic | 285 per million tokens | $1.425 | $5 | −71.50% |

### seedream 4.5

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| seedream 4.5, image-to-image | image | ByteDance | 6.5 per image | $0.0325 | $0.04 | −18.75% |
| seedream 4.5, text-to-image | image | ByteDance | 6.5 per image | $0.0325 | $0.04 | −18.75% |

### Qwen2 - Image edit

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Qwen2 - Image edit, text-to-image | image | Qwen | 5.6 per image | $0.028 | $0.035 | −20.00% |
| Qwen2 - Image edit, image-to-image | image | Qwen | 5.6 per image | $0.028 | $0.035 | −20.00% |

### gpt-5.4-codex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.4-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.60 | $15 | −62.67% |
| gpt-5.4-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $2.5 | −72.00% |

### gpt-5.4

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.4, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.60 | $15 | −62.67% |
| gpt-5.4, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $2.5 | −72.00% |

### kling 3.0 motion control

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| kling 3.0 motion control, video-to-video, 1080P | video | Kling | 27 per second | $0.135 | $0.168 | −19.64% |
| kling 3.0 motion control, video-to-video, 720P | video | Kling | 20 per second | $0.1 | $0.126 | −20.63% |

### gpt-5-codex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5-codex, Chat, Output | chat | OpenAI | 800 per million tokens | $4.0 | $10 | −60.00% |
| gpt-5-codex, Chat, Input | chat | OpenAI | 100 per million tokens | $0.50 | $1.25 | −60.00% |

### gpt-5.2-codex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.2-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.6 | $14 | −60.00% |
| gpt-5.2-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $1.75 | −60.00% |

### gpt-5.3-codex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.3-codex, Chat, Output | chat | OpenAI | 1120 per million tokens | $5.6 | $14 | −60.00% |
| gpt-5.3-codex, Chat, Input | chat | OpenAI | 140 per million tokens | $0.70 | $1.75 | −60.00% |

### gpt-5.1-codex

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5.1-codex, Chat, Output | chat | OpenAI | 800 per million tokens | $4.00 | $10 | −60.00% |
| gpt-5.1-codex, Chat, Input | chat | OpenAI | 100 per million tokens | $0.50 | $1.25 | −60.00% |

### gpt-5-2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| gpt-5-2, Chat, Input | chat | OpenAI | 87.5 per million tokens | $0.44 | $1.75 | −74.90% |
| gpt-5-2, Chat, Output | chat | OpenAI | 700 per million tokens | $3.5 | $14 | −75.00% |

### seedream 5.0 Lite

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| seedream 5.0 Lite, image-to-image | image | ByteDance | 5.5 per image | $0.0275 | $0.035 | −21.43% |
| seedream 5.0 Lite, text-to-image | image | ByteDance | 5.5 per image | $0.0275 | $0.035 | −21.43% |

### Gemini 3 Flash

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 3 Flash, Chat, Output | chat | Google | 180 per million tokens | $0.90 | $3 | −70.00% |
| Gemini 3 Flash, Chat, Input | chat | Google | 30 per million tokens | $0.15 | $0.5 | −70.00% |

### Gemini 3 Pro

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 3 Pro, Chat, Output | chat | Google | 700 per million tokens | $3.5 | $12 | −70.90% |
| Gemini 3 Pro, Chat, Input | chat | Google | 100 per million tokens | $0.50 | $2 | −75.00% |

### Google nano banana pro

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Google nano banana pro, 1/2K | image | Google | 18.0 per image | $0.09 | $0.15 | −40.00% |
| Google nano banana pro, 4K | image | Google | 24.0 per image | $0.12 | $0.3 | −60.00% |

### Black Forest Labs flux1-kontext

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Black Forest Labs flux1-kontext, text-to-image, Pro | image | Black Forest Labs | 5.0 per image | $0.025 | $0.08 | −68.75% |
| Black Forest Labs flux1-kontext, text-to-image, Max | image | Black Forest Labs | 10.0 per image | $0.05 | $0.08 | −37.50% |

### Topaz Video Upscaler

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Topaz Video Upscaler, upscale factor 4x | video | Topaz | 14 per second | $0.07 | $0.08 | −12.50% |
| Topaz Video Upscaler, upscale factor 1x/2x | video | Topaz | 8.0 per second | $0.04 | $0.08 | −50.00% |

### Kling AI Avtar

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Kling AI Avtar , lip sync, Standard-up to 15 secondss-720p | video | Kling | 8.0 per second | $0.04 | $0.0562 | −28.83% |
| Kling AI Avtar , lip sync, Pro-up to 15 secondss-1080p | video | Kling | 16.0 per second | $0.08 | $0.115 | −30.43% |

### MeiGen-AI InfiniteTalk

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| MeiGen-AI InfiniteTalk, lip sync, up to 15 secondss-480p | video | Other | 3.0 per second | $0.015 | $0.2 | −92.50% |
| MeiGen-AI InfiniteTalk, lip sync, up to 15 secondss-720p | video | Other | 12.0 per second | $0.06 | $0.4 | −85.00% |

### Elevenlabs Text to Speech

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Elevenlabs Text to Speech, turbo 2.5 | music | Elevenlabs | 6.0 per 1000 characters | $0.03 | $0.05 | −40.00% |
| Elevenlabs Text to Speech, multilingual v2 | music | Elevenlabs | 12.0 per 1000 characters | $0.06 | $0.1 | −40.00% |

### Qwen Image

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Qwen Image , text-to-image | image | Qwen | 4.0 per megapixel | $0.02 | $0.03 | −33.33% |
| Qwen Image, image-to-image | image | Qwen | 4.0 per megapixel | $0.02 | N/A | N/A |

### Gemini 2.5 flash

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 2.5 flash, Chat, Output | chat | Google | 150 per million tokens | $0.75 | $2.50 | −70.00% |
| Gemini 2.5 flash, Chat, Input | chat | Google | 18 per million tokens | $0.09 | $0.30 | −70.00% |

### Gemini 2.5 Pro

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Gemini 2.5 Pro, Chat, Output | chat | Google | 600 per million tokens | $3.00 | $10 | −70.00% |
| Gemini 2.5 Pro, Chat, Input | chat | Google | 76 per million tokens | $0.38 | $1.25 | −69.60% |

### kling 2.6 motion control

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| kling 2.6 motion control, video to video, 1080P | video | Kling | 18 per second | $0.09 | $0.112 | −19.64% |
| kling 2.6 motion control, video-to-video, 720P | video | Kling | 11 per second | $0.055 | $0.07 | −21.43% |

### wan 2.7 image pro

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.7 image pro | image | Wan | 12 per image | $0.06 | $0.075 | −20.00% |

### wan 2.7 image

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| wan 2.7 image | image | Wan | 4.8 per image | $0.024 | $0.03 | −20.00% |

### Recraft Remove Background

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Recraft Remove Background , image to image | image | Recraft | 1.0 per image | $0.005 | $0.01 | −50.00% |

### Elevenlabs V3

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Elevenlabs V3 , Text to dialogue | music | Elevenlabs | 14 per 1000 characters | $0.07 | $0.1 | −30.00% |

### Qwen z-image

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Qwen z-image, text-to-image, 1.0s | image | Qwen | 0.8 per image | $0.004 | $0.005 | −20.00% |

### OpenAI 4o image

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| OpenAI 4o image, text-to-image | image | OpenAI 4o | 6.0 per image | $0.03 | N/A | N/A |

### Recraft Crisp Upscale

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Recraft Crisp Upscale, image to image | image | Recraft | 0.5 per image | $0.0025 | $0.004 | −37.50% |

### Elevenlabs Audio Isolation

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Elevenlabs Audio Isolation | music | Elevenlabs | 0.2 per second | $0.001 | $0.0016 | −37.50% |

### Elevenlabs Sound Effect V2

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Elevenlabs Sound Effect V2 | music | Elevenlabs | 0.24 per second | $0.0012 | $0.002 | −40.00% |

### Google nano banana edit

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Google nano banana edit, image-to-image | image | Google | 4.0 per image | $0.02 | $0.039 | −48.72% |

### Google nano banana

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Google nano banana, text-to-image | image | Google | 4.0 per image | $0.02 | $0.039 | −48.72% |

### Runway Aleph

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Runway Aleph | video | Runway | 110.0 per video | $0.55 | N/A | N/A |

### Qwen image-edit

| Variant | Type | Provider | Credits / Gen | Our Price | Reference Price | Discount |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Qwen image-edit, image-to-image | image | Qwen | 5.0 per megapixel | $0.03 | $0.035 | −14.29% |

## References

[1]: https://kie.ai/pricing "KIE AI Pricing"
