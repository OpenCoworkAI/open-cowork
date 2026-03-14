# Configuring Common Compatible Providers

Open Cowork recommends provider setups based on the runtime/provider compatibility behavior used by the app. Some services work best with a specific compatibility protocol or with a dedicated provider tab.

| Service | Recommended setup | Base URL | Example model | Notes |
| --- | --- | --- | --- | --- |
| OpenRouter | Use the dedicated OpenRouter provider tab | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4-6` | Prefer the dedicated tab unless you are debugging a custom relay. |
| DeepSeek API | `Custom` + `OpenAI` | `https://api.deepseek.com/v1` | `deepseek-chat` | Use the exact model ID from DeepSeek docs. |
| Kimi Coding | `Custom` + `Anthropic` | `https://api.kimi.com/coding` | `kimi-k2-thinking` | Use the coding endpoint and verify the exact coding model ID from Moonshot docs. |
| GLM / BigModel (Anthropic route) | `Custom` + `Anthropic` | `https://open.bigmodel.cn/api/anthropic` | `glm-5` | Use this route when the endpoint path includes `/api/anthropic`. |
| Ollama | Use the dedicated Ollama provider tab | `http://localhost:11434/v1` | `qwen3.5:0.8b` | The dedicated tab supports local model refresh and discovery. |
| Gemini custom endpoint | `Custom` + `Gemini` | `https://generativelanguage.googleapis.com` | `gemini-2.5-flash` | Use the exact model ID exposed by the endpoint. |
| MiniMax | `Custom` + `OpenAI` | `https://api.minimax.chat/v1` | `MiniMax-M2.5` | Unless your gateway docs say otherwise, use OpenAI-compatible mode. |
| Generic OpenAI-compatible | `Custom` + `OpenAI` | `https://your-provider.example/v1` | `deepseek-chat` | For gateways or relays that mimic the OpenAI API. |

## Common probe errors

- `empty_probe_response`: The endpoint returned an empty probe response. This usually means the selected protocol or model is incompatible with the service.
- `probe_response_mismatch:*`: The endpoint responded, but not in the format expected by Open Cowork's probe. This usually points to a protocol or model compatibility mismatch.

These recommendations are informed by the compatibility behavior of the runtime stack Open Cowork uses, including `pi-ai`, but the in-app UI intentionally presents them as product-level setup guidance rather than internal implementation details.
