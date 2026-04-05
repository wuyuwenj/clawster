use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Wry};
use tokio::time;

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClawBotResponse {
    #[serde(rename = "type")]
    pub response_type: String,
    pub text: Option<String>,
    pub action: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub error: Option<String>,
    #[serde(rename = "gatewayUrl")]
    pub gateway_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub app: Option<String>,
    pub title: Option<String>,
    pub path: Option<String>,
    pub filename: Option<String>,
    pub at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesInputPart {
    #[serde(rename = "type")]
    part_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<ImageSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImageSource {
    #[serde(rename = "type")]
    source_type: String,
    media_type: String,
    data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResponsesInputItem {
    #[serde(rename = "type")]
    item_type: String,
    role: String,
    content: Vec<ResponsesInputPart>,
}

const SYSTEM_PROMPT: &str = r#"You are a desktop pet assistant running on the user's computer. You appear as an animated character on the user's screen.

Your capabilities:
- You can see which app the user is currently using
- You can see window titles (if enabled)
- You can watch for file changes in folders the user specifies
- You can capture and analyze what's on the user's screen
- You can move around on the desktop
- You can change your mood/animation state
- You can see cursor position when screen context is provided

ACTIONS - You can perform physical actions by including a JSON action block in your response:
```action
{"type": "set_mood", "value": "happy"}
```

Available actions:
- set_mood: Change your animation. Values: "idle", "happy", "curious", "sleeping", "thinking", "excited"
- move_to: Move to screen position. Include x, y coordinates: {"type": "move_to", "x": 500, "y": 300}
- move_to_cursor: Move near the user's cursor: {"type": "move_to_cursor"}
- snip: Do a claw snip animation: {"type": "snip"}
- wave: Wave your claws happily: {"type": "wave"}
- look_at: Move to look at a position: {"type": "look_at", "x": 800, "y": 400}

Screen coordinates: Top-left is (0,0). When you receive [Screen Context: ...], you'll see cursor position and screen size.

Interaction guidelines:
- Keep ALL responses very short (1-2 sentences max). You're a tiny desktop pet, not a chatbot. Be punchy and brief.
- When asked to move or do actions, DO include the action block AND a short verbal response.

Example response when asked to move:
"Coming over!
```action
{"type": "move_to_cursor"}
```""#;

// --- Action parsing ---

pub fn parse_action_from_response(text: &str) -> (String, Option<Value>) {
    // Match ```action followed by JSON
    if let Some(start) = text.find("```action") {
        let after_tag = &text[start + 9..];
        if let Some(end) = after_tag.find("```") {
            let json_str = after_tag[..end].trim();

            // Try direct parse first
            if let Ok(action) = serde_json::from_str::<Value>(json_str) {
                let clean = text.replace(&text[start..start + 9 + end + 3], "").trim().to_string();
                return (clean, Some(action));
            }

            // Fallback: extract type and value from malformed JSON
            if let Some(type_val) = extract_json_string(json_str, "type") {
                let mut action = serde_json::json!({"type": type_val});
                if let Some(val) = extract_json_string(json_str, "value") {
                    action["value"] = Value::String(val);
                }
                if let Some(x) = extract_json_number(json_str, "x") {
                    action["x"] = Value::Number(serde_json::Number::from_f64(x).unwrap());
                }
                if let Some(y) = extract_json_number(json_str, "y") {
                    action["y"] = Value::Number(serde_json::Number::from_f64(y).unwrap());
                }
                let clean = text.replace(&text[start..start + 9 + end + 3], "").trim().to_string();
                return (clean, Some(action));
            }
        }
    }
    (text.to_string(), None)
}

fn extract_json_string(text: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"\\s*:\\s*\"([^\"]+)\"", key);
    let re = regex_lite::Regex::new(&pattern).ok()?;
    re.captures(text).map(|c| c[1].to_string())
}

fn extract_json_number(text: &str, key: &str) -> Option<f64> {
    let pattern = format!("\"{}\"\\s*:\\s*([0-9.]+)", key);
    let re = regex_lite::Regex::new(&pattern).ok()?;
    re.captures(text).and_then(|c| c[1].parse().ok())
}

fn to_clawbot_response(raw_text: &str) -> ClawBotResponse {
    let (clean_text, action) = parse_action_from_response(raw_text);
    if let Some(action_val) = action {
        // Wrap action as {type, payload} to match Electron format
        let action_type = action_val.get("type").and_then(|t| t.as_str()).unwrap_or("unknown").to_string();
        let wrapped = serde_json::json!({
            "type": action_type,
            "payload": action_val
        });
        ClawBotResponse {
            response_type: "action".to_string(),
            text: if clean_text.is_empty() { None } else { Some(clean_text) },
            action: Some(wrapped),
        }
    } else {
        ClawBotResponse {
            response_type: "message".to_string(),
            text: Some(clean_text),
            action: None,
        }
    }
}

// --- Extract text from API responses ---

fn extract_text_from_payload(data: &Value) -> Option<String> {
    // Responses API format
    if let Some(output) = data.get("output") {
        if let Some(arr) = output.as_array() {
            for item in arr {
                if let Some(content) = item.get("content") {
                    if let Some(content_arr) = content.as_array() {
                        for part in content_arr {
                            if part.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                                return part.get("text").and_then(|t| t.as_str()).map(String::from);
                            }
                        }
                    }
                }
            }
        }
    }
    // Chat Completions format
    if let Some(choices) = data.get("choices") {
        if let Some(arr) = choices.as_array() {
            if let Some(first) = arr.first() {
                if let Some(msg) = first.get("message") {
                    return msg.get("content").and_then(|c| c.as_str()).map(String::from);
                }
            }
        }
    }
    // Direct text field
    data.get("text").and_then(|t| t.as_str()).map(String::from)
}

fn extract_delta_from_stream(chunk: &Value) -> Option<String> {
    // Responses API stream: response.output_text.delta
    if let Some(delta) = chunk.get("delta") {
        return delta.as_str().map(String::from);
    }
    // Chat Completions stream format
    if let Some(choices) = chunk.get("choices") {
        if let Some(arr) = choices.as_array() {
            if let Some(first) = arr.first() {
                if let Some(delta) = first.get("delta") {
                    return delta.get("content").and_then(|c| c.as_str()).map(String::from);
                }
            }
        }
    }
    None
}

// --- ClawBot Client ---

pub struct ClawBotClient {
    client: tokio::sync::OnceCell<Client>,
    base_url: Mutex<String>,
    token: Mutex<String>,
    agent_id: Mutex<Option<String>>,
    connected: AtomicBool,
    last_error: Mutex<Option<String>>,
    prefer_chat_completions: AtomicBool,
}

impl ClawBotClient {
    pub fn new(base_url: String, token: String, agent_id: Option<String>) -> Self {
        Self {
            client: tokio::sync::OnceCell::new(),
            base_url: Mutex::new(base_url),
            token: Mutex::new(token),
            agent_id: Mutex::new(agent_id),
            connected: AtomicBool::new(false),
            last_error: Mutex::new(None),
            prefer_chat_completions: AtomicBool::new(false),
        }
    }

    async fn http(&self) -> &Client {
        self.client.get_or_init(|| async {
            Client::builder()
                .timeout(Duration::from_secs(60))
                .build()
                .expect("failed to build reqwest client")
        }).await
    }

    pub fn update_config(&self, base_url: String, token: String, agent_id: Option<String>) {
        *self.base_url.lock().unwrap() = base_url;
        *self.token.lock().unwrap() = token;
        *self.agent_id.lock().unwrap() = agent_id;
        self.prefer_chat_completions.store(false, Ordering::Relaxed);
    }

    fn get_base_url(&self) -> String {
        self.base_url.lock().unwrap().clone()
    }

    fn get_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
        let token = self.token.lock().unwrap().clone();
        if !token.is_empty() {
            headers.push(("Authorization".to_string(), format!("Bearer {}", token)));
        }
        let agent_id = self.agent_id.lock().unwrap().clone();
        if let Some(id) = agent_id {
            headers.push(("x-openclaw-agent-id".to_string(), id));
        }
        headers
    }

    async fn build_request(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.http().await.post(url);
        for (key, value) in self.get_headers() {
            req = req.header(&key, &value);
        }
        req
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn get_connection_status(&self) -> ConnectionStatus {
        ConnectionStatus {
            connected: self.connected.load(Ordering::Relaxed),
            error: self.last_error.lock().unwrap().clone(),
            gateway_url: self.get_base_url(),
        }
    }

    pub async fn check_connection(&self) -> bool {
        let url = format!("{}/health", self.get_base_url());
        let was_connected = self.connected.load(Ordering::Relaxed);

        let client = self.http().await;
        let mut req = client.get(&url);
        for (key, value) in self.get_headers() {
            req = req.header(&key, &value);
        }

        match req.timeout(Duration::from_secs(3)).send().await {
            Ok(resp) if resp.status().is_success() => {
                self.connected.store(true, Ordering::Relaxed);
                *self.last_error.lock().unwrap() = None;
            }
            Ok(resp) => {
                self.connected.store(false, Ordering::Relaxed);
                *self.last_error.lock().unwrap() =
                    Some(format!("Gateway returned status {}", resp.status()));
            }
            Err(e) => {
                self.connected.store(false, Ordering::Relaxed);
                *self.last_error.lock().unwrap() = Some(e.to_string());
            }
        }

        let now_connected = self.connected.load(Ordering::Relaxed);
        was_connected != now_connected
    }

    fn build_text_messages(
        &self,
        message: &str,
        history: &[Value],
    ) -> Vec<serde_json::Map<String, Value>> {
        let mut messages = Vec::new();
        let agent_id = self.agent_id.lock().unwrap().clone();

        if agent_id.is_some() {
            let mut msg = serde_json::Map::new();
            msg.insert("role".to_string(), Value::String("system".to_string()));
            msg.insert("content".to_string(), Value::String(SYSTEM_PROMPT.to_string()));
            messages.push(msg);
        }

        // Add recent history (last 20)
        let start = if history.len() > 20 { history.len() - 20 } else { 0 };
        for h in &history[start..] {
            if let Some(obj) = h.as_object() {
                messages.push(obj.clone());
            }
        }

        let mut user_msg = serde_json::Map::new();
        user_msg.insert("role".to_string(), Value::String("user".to_string()));
        user_msg.insert("content".to_string(), Value::String(message.to_string()));
        messages.push(user_msg);

        messages
    }

    fn build_responses_input(
        &self,
        messages: &[serde_json::Map<String, Value>],
    ) -> Vec<Value> {
        messages
            .iter()
            .map(|msg| {
                let role = msg
                    .get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("user");
                let content = msg
                    .get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                serde_json::json!({
                    "type": "message",
                    "role": Self::normalize_role(role),
                    "content": [{"type": "input_text", "text": content}]
                })
            })
            .collect()
    }

    fn normalize_role(role: &str) -> &str {
        match role {
            "system" | "developer" | "assistant" | "user" => role,
            _ => "user",
        }
    }

    fn normalize_completions_role(role: &str) -> &str {
        match role {
            "system" | "assistant" | "user" => role,
            "developer" => "system",
            _ => "user",
        }
    }

    fn build_completions_messages(
        &self,
        messages: &[serde_json::Map<String, Value>],
    ) -> Vec<Value> {
        messages
            .iter()
            .map(|msg| {
                let role = msg
                    .get("role")
                    .and_then(|r| r.as_str())
                    .unwrap_or("user");
                let content = msg.get("content").cloned().unwrap_or(Value::String(String::new()));
                serde_json::json!({
                    "role": Self::normalize_completions_role(role),
                    "content": content
                })
            })
            .collect()
    }

    fn should_fallback(&self, status: u16, error_text: &str) -> bool {
        if status == 405 { return true; }
        let is_responses_error = error_text.contains("responses")
            || error_text.contains("not found")
            || error_text.contains("Not Found");
        if status == 404 && is_responses_error { return true; }
        if status >= 500 && is_responses_error { return true; }
        false
    }

    // --- Chat (non-streaming) ---

    pub async fn chat(
        &self,
        message: &str,
        history: &[Value],
    ) -> ClawBotResponse {
        if !self.is_connected() {
            return ClawBotResponse {
                response_type: "message".to_string(),
                text: Some("ClawBot is not connected. Check if it's running.".to_string()),
                action: None,
            };
        }

        let messages = self.build_text_messages(message, history);

        if self.prefer_chat_completions.load(Ordering::Relaxed) {
            return self.chat_via_completions(&messages).await;
        }

        let url = format!("{}/v1/responses", self.get_base_url());
        let body = serde_json::json!({
            "model": "openclaw",
            "input": self.build_responses_input(&messages),
        });

        match self.build_request(&url).await.json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Value>().await {
                    Ok(data) => {
                        let text = extract_text_from_payload(&data).unwrap_or_else(|| "No response".to_string());
                        to_clawbot_response(&text)
                    }
                    Err(e) => ClawBotResponse {
                        response_type: "message".to_string(),
                        text: Some(format!("Failed to parse response: {}", e)),
                        action: None,
                    },
                }
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let error_text = resp.text().await.unwrap_or_default();
                if self.should_fallback(status, &error_text) {
                    self.prefer_chat_completions.store(true, Ordering::Relaxed);
                    return self.chat_via_completions(&messages).await;
                }
                ClawBotResponse {
                    response_type: "message".to_string(),
                    text: Some(format!("Gateway error ({})", status)),
                    action: None,
                }
            }
            Err(e) => ClawBotResponse {
                response_type: "message".to_string(),
                text: Some(format!("Failed to reach ClawBot: {}", e)),
                action: None,
            },
        }
    }

    async fn chat_via_completions(
        &self,
        messages: &[serde_json::Map<String, Value>],
    ) -> ClawBotResponse {
        let url = format!("{}/v1/chat/completions", self.get_base_url());
        let body = serde_json::json!({
            "model": "openclaw",
            "messages": self.build_completions_messages(messages),
        });

        match self.build_request(&url).await.json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Value>().await {
                    Ok(data) => {
                        let text = extract_text_from_payload(&data).unwrap_or_else(|| "No response".to_string());
                        to_clawbot_response(&text)
                    }
                    Err(e) => ClawBotResponse {
                        response_type: "message".to_string(),
                        text: Some(format!("Failed to parse response: {}", e)),
                        action: None,
                    },
                }
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                ClawBotResponse {
                    response_type: "message".to_string(),
                    text: Some(format!("Gateway error ({})", status)),
                    action: None,
                }
            }
            Err(e) => ClawBotResponse {
                response_type: "message".to_string(),
                text: Some(format!("Failed to reach ClawBot: {}", e)),
                action: None,
            },
        }
    }

    // --- Streaming chat ---

    pub async fn chat_stream(
        &self,
        message: &str,
        history: &[Value],
        app_handle: &AppHandle<Wry>,
        request_id: &str,
    ) -> ClawBotResponse {
        if !self.is_connected() {
            return ClawBotResponse {
                response_type: "message".to_string(),
                text: Some("ClawBot is not connected. Check if it's running.".to_string()),
                action: None,
            };
        }

        let messages = self.build_text_messages(message, history);

        if self.prefer_chat_completions.load(Ordering::Relaxed) {
            return self.stream_via_completions(&messages, app_handle, request_id).await;
        }

        let url = format!("{}/v1/responses", self.get_base_url());
        let body = serde_json::json!({
            "model": "openclaw",
            "input": self.build_responses_input(&messages),
            "stream": true,
        });

        match self.build_request(&url).await.json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                self.consume_stream(resp, app_handle, request_id).await
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let error_text = resp.text().await.unwrap_or_default();
                if self.should_fallback(status, &error_text) {
                    self.prefer_chat_completions.store(true, Ordering::Relaxed);
                    return self.stream_via_completions(&messages, app_handle, request_id).await;
                }
                ClawBotResponse {
                    response_type: "message".to_string(),
                    text: Some(format!("Gateway error ({})", status)),
                    action: None,
                }
            }
            Err(e) => ClawBotResponse {
                response_type: "message".to_string(),
                text: Some(format!("Failed to reach ClawBot: {}", e)),
                action: None,
            },
        }
    }

    async fn stream_via_completions(
        &self,
        messages: &[serde_json::Map<String, Value>],
        app_handle: &AppHandle<Wry>,
        request_id: &str,
    ) -> ClawBotResponse {
        let url = format!("{}/v1/chat/completions", self.get_base_url());
        let body = serde_json::json!({
            "model": "openclaw",
            "messages": self.build_completions_messages(messages),
            "stream": true,
        });

        match self.build_request(&url).await.json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                self.consume_stream(resp, app_handle, request_id).await
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                ClawBotResponse {
                    response_type: "message".to_string(),
                    text: Some(format!("Gateway error ({})", status)),
                    action: None,
                }
            }
            Err(e) => ClawBotResponse {
                response_type: "message".to_string(),
                text: Some(format!("Failed to reach ClawBot: {}", e)),
                action: None,
            },
        }
    }

    async fn consume_stream(
        &self,
        resp: reqwest::Response,
        app_handle: &AppHandle<Wry>,
        request_id: &str,
    ) -> ClawBotResponse {
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();

        while let Some(chunk_result) = stream.next().await {
            let bytes = match chunk_result {
                Ok(b) => b,
                Err(e) => {
                    let _ = app_handle.emit("clawbot-stream-error", serde_json::json!({
                        "requestId": request_id,
                        "error": e.to_string(),
                    }));
                    break;
                }
            };

            buffer.push_str(&String::from_utf8_lossy(&bytes));
            let events: Vec<String> = buffer.split("\n\n").map(String::from).collect();
            let last = events.last().cloned().unwrap_or_default();
            buffer = last;

            for evt in &events[..events.len().saturating_sub(1)] {
                for line in evt.as_str().lines() {
                    let trimmed = line.trim();
                    if !trimmed.starts_with("data:") {
                        continue;
                    }
                    let payload = trimmed[5..].trim();
                    if payload == "[DONE]" {
                        continue;
                    }
                    if let Ok(chunk) = serde_json::from_str::<Value>(payload) {
                        if let Some(delta) = extract_delta_from_stream(&chunk) {
                            full_text.push_str(&delta);
                            let _ = app_handle.emit("clawbot-stream-chunk", serde_json::json!({
                                "requestId": request_id,
                                "delta": delta,
                                "text": full_text,
                            }));
                        }
                    }
                }
            }
        }

        // Process remaining buffer
        for line in buffer.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with("data:") {
                continue;
            }
            let payload = trimmed[5..].trim();
            if payload == "[DONE]" {
                continue;
            }
            if let Ok(chunk) = serde_json::from_str::<Value>(payload) {
                if let Some(delta) = extract_delta_from_stream(&chunk) {
                    full_text.push_str(&delta);
                }
            }
        }

        let response = if full_text.is_empty() {
            ClawBotResponse {
                response_type: "message".to_string(),
                text: Some("No response".to_string()),
                action: None,
            }
        } else {
            to_clawbot_response(&full_text)
        };

        let _ = app_handle.emit("clawbot-stream-end", serde_json::json!({
            "requestId": request_id,
            "response": &response,
        }));

        response
    }

    // --- Analyze screen with image ---

    pub async fn analyze_screen(
        &self,
        image_data_url: &str,
        question: &str,
    ) -> ClawBotResponse {
        if !self.is_connected() {
            return ClawBotResponse {
                response_type: "message".to_string(),
                text: Some("ClawBot is not connected.".to_string()),
                action: None,
            };
        }

        let user_question = if question.is_empty() { "What do you see? How can you help?" } else { question };

        // Parse base64 image
        let image_source = if let Some(caps) = image_data_url.strip_prefix("data:") {
            if let Some((mime, b64)) = caps.split_once(";base64,") {
                Some(serde_json::json!({
                    "type": "base64",
                    "media_type": mime,
                    "data": b64
                }))
            } else { None }
        } else { None };

        let Some(img_src) = image_source else {
            return ClawBotResponse {
                response_type: "message".to_string(),
                text: Some("Invalid screenshot format.".to_string()),
                action: None,
            };
        };

        // Try Responses API first
        if !self.prefer_chat_completions.load(Ordering::Relaxed) {
            let url = format!("{}/v1/responses", self.get_base_url());
            let mut input = Vec::new();

            let agent_id = self.agent_id.lock().unwrap().clone();
            if agent_id.is_some() {
                input.push(serde_json::json!({
                    "type": "message",
                    "role": "system",
                    "content": [{"type": "input_text", "text": SYSTEM_PROMPT}]
                }));
            }

            input.push(serde_json::json!({
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": format!("{}\n\nPlease analyze the attached screenshot.", user_question)},
                    {"type": "input_image", "source": img_src}
                ]
            }));

            let body = serde_json::json!({ "model": "openclaw", "input": input });

            match self.build_request(&url).await.json(&body)
                .timeout(Duration::from_secs(120))
                .send().await
            {
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(data) = resp.json::<Value>().await {
                        let text = extract_text_from_payload(&data).unwrap_or_else(|| "No response".to_string());
                        return to_clawbot_response(&text);
                    }
                }
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let error_text = resp.text().await.unwrap_or_default();
                    if self.should_fallback(status, &error_text) {
                        self.prefer_chat_completions.store(true, Ordering::Relaxed);
                        // Fall through to completions
                    } else {
                        return ClawBotResponse {
                            response_type: "message".to_string(),
                            text: Some(format!("Gateway error ({})", status)),
                            action: None,
                        };
                    }
                }
                Err(e) => {
                    return ClawBotResponse {
                        response_type: "message".to_string(),
                        text: Some(format!("Failed to reach ClawBot: {}", e)),
                        action: None,
                    };
                }
            }
        }

        // Chat Completions fallback with image_url
        let url = format!("{}/v1/chat/completions", self.get_base_url());
        let mut messages = Vec::new();
        let agent_id = self.agent_id.lock().unwrap().clone();
        if agent_id.is_some() {
            messages.push(serde_json::json!({"role": "system", "content": SYSTEM_PROMPT}));
        }
        messages.push(serde_json::json!({
            "role": "user",
            "content": [
                {"type": "text", "text": format!("{}\n\nPlease analyze the attached screenshot.", user_question)},
                {"type": "image_url", "image_url": {"url": image_data_url}}
            ]
        }));

        let body = serde_json::json!({ "model": "openclaw", "messages": messages });

        match self.build_request(&url).await.json(&body)
            .timeout(Duration::from_secs(120))
            .send().await
        {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(data) = resp.json::<Value>().await {
                    let text = extract_text_from_payload(&data).unwrap_or_else(|| "No response".to_string());
                    return to_clawbot_response(&text);
                }
            }
            _ => {}
        }

        ClawBotResponse {
            response_type: "message".to_string(),
            text: Some("Failed to analyze screenshot.".to_string()),
            action: None,
        }
    }

    // --- Send activity event ---

    pub async fn send_event(&self, event: &ActivityEvent) {
        if !self.is_connected() {
            return;
        }
        let url = format!("{}/events", self.get_base_url());
        let client = self.http().await;
        let mut req = client.post(&url);
        for (key, value) in self.get_headers() {
            req = req.header(&key, &value);
        }
        let _ = req.json(event).timeout(Duration::from_secs(5)).send().await;
    }

    // --- Suggestion polling ---

    pub async fn poll_suggestions(&self) -> Option<Value> {
        if !self.is_connected() {
            return None;
        }
        let url = format!("{}/suggestions", self.get_base_url());
        let client = self.http().await;
        let mut req = client.get(&url);
        for (key, value) in self.get_headers() {
            req = req.header(&key, &value);
        }
        match req.timeout(Duration::from_secs(5)).send().await {
            Ok(resp) if resp.status().is_success() => resp.json().await.ok(),
            _ => None,
        }
    }
}

// --- Background polling task ---

pub fn start_polling(clawbot: Arc<ClawBotClient>, app_handle: AppHandle<Wry>) {
    // Connection + suggestion polling every 5 seconds
    let clawbot_clone = clawbot.clone();
    let app_clone = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(5));
        loop {
            interval.tick().await;
            let status_changed = clawbot_clone.check_connection().await;
            if status_changed {
                let _ = app_clone.emit(
                    "clawbot-connection-changed",
                    clawbot_clone.get_connection_status(),
                );
            }

            if clawbot_clone.is_connected() {
                if let Some(data) = clawbot_clone.poll_suggestions().await {
                    if let Some(suggestion) = data.get("suggestion") {
                        if !suggestion.is_null() {
                            let _ = app_clone.emit("clawbot-suggestion", suggestion);
                        }
                    }
                    if let Some(mood) = data.get("mood") {
                        if !mood.is_null() {
                            let _ = app_clone.emit("clawbot-mood", mood);
                        }
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_action_valid_json() {
        let text = r#"Coming over!
```action
{"type": "move_to_cursor"}
```"#;
        let (clean, action) = parse_action_from_response(text);
        assert_eq!(clean, "Coming over!");
        let action = action.unwrap();
        assert_eq!(action.get("type").unwrap().as_str().unwrap(), "move_to_cursor");
    }

    #[test]
    fn test_parse_action_with_coordinates() {
        let text = r#"Moving!
```action
{"type": "move_to", "x": 500, "y": 300}
```"#;
        let (clean, action) = parse_action_from_response(text);
        assert_eq!(clean, "Moving!");
        let action = action.unwrap();
        assert_eq!(action.get("type").unwrap().as_str().unwrap(), "move_to");
        assert_eq!(action.get("x").unwrap().as_f64().unwrap(), 500.0);
        assert_eq!(action.get("y").unwrap().as_f64().unwrap(), 300.0);
    }

    #[test]
    fn test_parse_action_malformed_json_fallback() {
        let text = r#"Hello!
```action
{"type": "set_mood", "happy"}
```"#;
        let (clean, action) = parse_action_from_response(text);
        assert_eq!(clean, "Hello!");
        let action = action.unwrap();
        assert_eq!(action.get("type").unwrap().as_str().unwrap(), "set_mood");
    }

    #[test]
    fn test_parse_action_no_action_block() {
        let text = "Just a normal message with no actions.";
        let (clean, action) = parse_action_from_response(text);
        assert_eq!(clean, "Just a normal message with no actions.");
        assert!(action.is_none());
    }

    #[test]
    fn test_extract_text_responses_api() {
        let data = serde_json::json!({
            "output": [{
                "content": [{
                    "type": "output_text",
                    "text": "Hello from responses API"
                }]
            }]
        });
        assert_eq!(
            extract_text_from_payload(&data).unwrap(),
            "Hello from responses API"
        );
    }

    #[test]
    fn test_extract_text_chat_completions() {
        let data = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "Hello from completions"
                }
            }]
        });
        assert_eq!(
            extract_text_from_payload(&data).unwrap(),
            "Hello from completions"
        );
    }

    #[test]
    fn test_extract_text_empty() {
        let data = serde_json::json!({});
        assert!(extract_text_from_payload(&data).is_none());
    }

    #[test]
    fn test_extract_delta_responses_stream() {
        let chunk = serde_json::json!({"delta": "Hello "});
        assert_eq!(extract_delta_from_stream(&chunk).unwrap(), "Hello ");
    }

    #[test]
    fn test_extract_delta_completions_stream() {
        let chunk = serde_json::json!({
            "choices": [{"delta": {"content": "world"}}]
        });
        assert_eq!(extract_delta_from_stream(&chunk).unwrap(), "world");
    }

    #[test]
    fn test_to_clawbot_response_message() {
        let resp = to_clawbot_response("Just text");
        assert_eq!(resp.response_type, "message");
        assert_eq!(resp.text.unwrap(), "Just text");
        assert!(resp.action.is_none());
    }

    #[test]
    fn test_to_clawbot_response_action_wrapped() {
        let text = r#"Doing it!
```action
{"type": "wave"}
```"#;
        let resp = to_clawbot_response(text);
        assert_eq!(resp.response_type, "action");
        assert_eq!(resp.text.unwrap(), "Doing it!");
        let action = resp.action.unwrap();
        // Verify wrapped format {type, payload}
        assert_eq!(action.get("type").unwrap().as_str().unwrap(), "wave");
        assert!(action.get("payload").is_some());
    }

    #[test]
    fn test_extract_json_string() {
        assert_eq!(
            extract_json_string(r#"{"type": "set_mood", "value": "happy"}"#, "value").unwrap(),
            "happy"
        );
    }

    #[test]
    fn test_extract_json_number() {
        assert_eq!(
            extract_json_number(r#"{"x": 123, "y": 456}"#, "x").unwrap(),
            123.0
        );
    }
}
