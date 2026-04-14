//! Codestral AI completion — FIM and chat via Mistral API.

use serde::{Deserialize, Serialize};

const CODESTRAL_FIM_URL: &str = "https://codestral.mistral.ai/v1/fim/completions";
const CODESTRAL_CHAT_URL: &str = "https://codestral.mistral.ai/v1/chat/completions";

#[derive(Deserialize)]
struct FimChoice {
    message: Option<FimMessage>,
}

#[derive(Deserialize)]
struct FimMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct FimResponse {
    choices: Option<Vec<FimChoice>>,
}

#[derive(Serialize)]
struct FimRequest {
    model: String,
    prompt: String,
    suffix: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
    max_tokens: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: Option<ChatChoiceMessage>,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: Option<String>,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Option<Vec<ChatChoice>>,
}

// ── Tauri commands ──

#[tauri::command]
pub async fn codestral_fim(
    api_key: String,
    prefix: String,
    suffix: String,
    language: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = FimRequest {
        model: "codestral-latest".to_string(),
        prompt: prefix,
        suffix,
        language,
        max_tokens: 512,
    };

    let response = client
        .post(CODESTRAL_FIM_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Codestral FIM request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Codestral FIM error {}: {}", status, text));
    }

    let data: FimResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse FIM response: {}", e))?;

    let content = data
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default();

    Ok(content)
}

#[tauri::command]
pub async fn codestral_chat(
    api_key: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    let body = ChatRequest {
        model: "codestral-latest".to_string(),
        messages,
        max_tokens: 2048,
    };

    let response = client
        .post(CODESTRAL_CHAT_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Codestral chat request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Codestral chat error {}: {}", status, text));
    }

    let data: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse chat response: {}", e))?;

    let content = data
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default();

    Ok(content)
}
