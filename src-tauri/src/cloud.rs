//! Cloud provider API calls via reqwest — Tauri IPC commands.
//!
//! Stores API tokens in memory (per project, per connector).
//! Makes HTTP requests to GitHub, Vercel, Supabase, etc.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

// ── State ──

pub struct CloudState {
    /// projectId -> connectorId -> token
    tokens: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl CloudState {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
        }
    }
}

// ── Helpers ──

fn get_token(state: &State<CloudState>, project_id: &str, connector_id: &str) -> Result<String, String> {
    let tokens = state.tokens.lock().map_err(|e| e.to_string())?;
    tokens
        .get(project_id)
        .and_then(|m| m.get(connector_id))
        .cloned()
        .ok_or_else(|| format!("No token for connector '{}' in project '{}'", connector_id, project_id))
}

async fn github_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.github.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn github_post(token: &str, path: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("https://api.github.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "PiPilot-IDE")
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn vercel_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.vercel.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn supabase_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.supabase.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn supabase_post(token: &str, path: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("https://api.supabase.com{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .header("User-Agent", "PiPilot-IDE")
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn cloudflare_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.cloudflare.com/client/v4{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn netlify_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://api.netlify.com/api/v1{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

async fn neon_get(token: &str, path: &str) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("https://console.neon.tech/api/v2{}", path))
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "PiPilot-IDE")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

// ── Token management commands ──

#[tauri::command]
pub async fn cloud_save_token(
    state: State<'_, CloudState>,
    project_id: String,
    connector_id: String,
    token: String,
) -> Result<Value, String> {
    let mut tokens = state.tokens.lock().map_err(|e| e.to_string())?;
    tokens
        .entry(project_id)
        .or_insert_with(HashMap::new)
        .insert(connector_id, token);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn cloud_status(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let tokens = state.tokens.lock().map_err(|e| e.to_string())?;
    let mut providers: HashMap<String, bool> = HashMap::new();
    let known = ["github", "vercel", "supabase", "neon", "netlify", "cloudflare"];
    if let Some(project_tokens) = tokens.get(&project_id) {
        for k in &known {
            providers.insert(k.to_string(), project_tokens.contains_key(*k));
        }
    } else {
        for k in &known {
            providers.insert(k.to_string(), false);
        }
    }
    Ok(serde_json::json!({ "providers": providers }))
}

// ── GitHub commands ──

#[tauri::command]
pub async fn cloud_github_repos(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    github_get(&token, "/user/repos?per_page=100&sort=updated").await
}

#[tauri::command]
pub async fn cloud_github_issues(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    github_get(&token, &format!("/repos/{}/{}/issues?per_page=50", owner, repo)).await
}

#[tauri::command]
pub async fn cloud_github_pulls(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    github_get(&token, &format!("/repos/{}/{}/pulls?per_page=50", owner, repo)).await
}

#[tauri::command]
pub async fn cloud_github_actions(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    github_get(&token, &format!("/repos/{}/{}/actions/runs?per_page=20", owner, repo)).await
}

#[tauri::command]
pub async fn cloud_github_branches(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    github_get(&token, &format!("/repos/{}/{}/branches?per_page=100", owner, repo)).await
}

#[tauri::command]
pub async fn cloud_github_commits(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
    per_page: Option<u32>,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    let n = per_page.unwrap_or(15);
    github_get(&token, &format!("/repos/{}/{}/commits?per_page={}", owner, repo, n)).await
}

#[tauri::command]
pub async fn cloud_github_create_repo(
    state: State<'_, CloudState>,
    project_id: String,
    name: String,
    description: String,
    private: bool,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    let body = serde_json::json!({
        "name": name,
        "description": description,
        "private": private,
    });
    github_post(&token, "/user/repos", &body).await
}

#[tauri::command]
pub async fn cloud_github_create_issue(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
    title: String,
    body: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    let payload = serde_json::json!({
        "title": title,
        "body": body,
    });
    github_post(&token, &format!("/repos/{}/{}/issues", owner, repo), &payload).await
}

#[tauri::command]
pub async fn cloud_github_create_pr(
    state: State<'_, CloudState>,
    project_id: String,
    owner: String,
    repo: String,
    title: String,
    body: String,
    head: String,
    base: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "github")?;
    let payload = serde_json::json!({
        "title": title,
        "body": body,
        "head": head,
        "base": base,
    });
    github_post(&token, &format!("/repos/{}/{}/pulls", owner, repo), &payload).await
}

// ── Vercel commands ──

#[tauri::command]
pub async fn cloud_vercel_projects(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "vercel")?;
    vercel_get(&token, "/v9/projects").await
}

#[tauri::command]
pub async fn cloud_vercel_deployments(
    state: State<'_, CloudState>,
    project_id: String,
    vercel_project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "vercel")?;
    vercel_get(&token, &format!("/v6/deployments?projectId={}", vercel_project_id)).await
}

#[tauri::command]
pub async fn cloud_vercel_env(
    state: State<'_, CloudState>,
    project_id: String,
    vercel_project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "vercel")?;
    vercel_get(&token, &format!("/v9/projects/{}/env", vercel_project_id)).await
}

#[tauri::command]
pub async fn cloud_vercel_domains(
    state: State<'_, CloudState>,
    project_id: String,
    vercel_project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "vercel")?;
    vercel_get(&token, &format!("/v9/projects/{}/domains", vercel_project_id)).await
}

// ── Supabase commands ──

#[tauri::command]
pub async fn cloud_supabase_projects(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "supabase")?;
    supabase_get(&token, "/v1/projects").await
}

#[tauri::command]
pub async fn cloud_supabase_sql(
    state: State<'_, CloudState>,
    project_id: String,
    sb_ref: String,
    query: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "supabase")?;
    let body = serde_json::json!({ "query": query });
    supabase_post(&token, &format!("/v1/projects/{}/database/query", sb_ref), &body).await
}

// ── Neon commands ──

#[tauri::command]
pub async fn cloud_neon_projects(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "neon")?;
    neon_get(&token, "/projects").await
}

// ── Netlify commands ──

#[tauri::command]
pub async fn cloud_netlify_sites(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "netlify")?;
    netlify_get(&token, "/sites").await
}

// ── Cloudflare commands ──

#[tauri::command]
pub async fn cloud_cloudflare_zones(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "cloudflare")?;
    cloudflare_get(&token, "/zones").await
}

#[tauri::command]
pub async fn cloud_cloudflare_dns(
    state: State<'_, CloudState>,
    project_id: String,
    zone_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "cloudflare")?;
    cloudflare_get(&token, &format!("/zones/{}/dns_records", zone_id)).await
}

#[tauri::command]
pub async fn cloud_cloudflare_account(
    state: State<'_, CloudState>,
    project_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "cloudflare")?;
    cloudflare_get(&token, "/accounts").await
}

#[tauri::command]
pub async fn cloud_cloudflare_workers(
    state: State<'_, CloudState>,
    project_id: String,
    account_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "cloudflare")?;
    cloudflare_get(&token, &format!("/accounts/{}/workers/scripts", account_id)).await
}

#[tauri::command]
pub async fn cloud_cloudflare_pages(
    state: State<'_, CloudState>,
    project_id: String,
    account_id: String,
) -> Result<Value, String> {
    let token = get_token(&state, &project_id, "cloudflare")?;
    cloudflare_get(&token, &format!("/accounts/{}/pages/projects", account_id)).await
}
