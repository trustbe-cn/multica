package sub2api

// RuntimeProtocols describes the implemented native configuration adapters,
// not a per-key upstream ACL. Administrator grants remain the ownership boundary.
func RuntimeProtocols(kind string) []string {
	switch kind {
	case "claude":
		return []string{"anthropic-messages"}
	case "codex":
		return []string{"openai-responses"}
	case "grok":
		return []string{"openai-responses", "openai-chat-completions"}
	case "opencode", "kimi":
		return []string{"openai-chat-completions"}
	case "pi":
		return []string{"openai-chat-completions", "anthropic-messages", "openai-responses", "google-generative-ai"}
	case "omp", "openclaw":
		return []string{"openai-chat-completions", "anthropic-messages", "openai-responses"}
	}
	return nil
}

// platformRuntimes narrows vendor platforms whose models only work through
// specific CLIs. Generic platforms fall back to protocol compatibility.
var platformRuntimes = map[string][]string{
	"grok":     {"grok"},
	"deepseek": {"opencode", "pi"},
	"gemini":   {"pi"},
}

// protocolAPIType maps an upstream protocol to the adapter API type. A
// platform/protocol pair outside this table grants no runtime.
func protocolAPIType(platform, protocol string) string {
	switch {
	case platform == "anthropic" && protocol == "anthropic_messages":
		return "anthropic-messages"
	case platform == "openai" && protocol == "openai_responses":
		return "openai-responses"
	case (platform == "openai" || platform == "grok" || platform == "deepseek") && protocol == "openai_chat_completions":
		return "openai-chat-completions"
	case platform == "gemini" && protocol == "gemini_generate_content":
		return "google-generative-ai"
	}
	return ""
}

// supportedPlatform reports whether Multica maps any protocol for the platform;
// such a key must declare its protocols rather than silently grant nothing.
func supportedPlatform(platform string) bool {
	switch platform {
	case "anthropic", "openai", "grok", "deepseek", "gemini":
		return true
	}
	return false
}

func CompatibleRuntimes(platform string, protocols []string) []string {
	available := []string{}
	for _, p := range protocols {
		if apiType := protocolAPIType(platform, p); apiType != "" {
			available = append(available, apiType)
		}
	}
	kinds := []string{}
	for _, kind := range []string{"claude", "codex", "opencode", "openclaw", "grok", "kimi", "omp", "pi"} {
		if allowed, ok := platformRuntimes[platform]; ok && !Contains(allowed, kind) {
			continue
		}
		for _, p := range RuntimeProtocols(kind) {
			if Contains(available, p) {
				kinds = append(kinds, kind)
				break
			}
		}
	}
	return kinds
}
