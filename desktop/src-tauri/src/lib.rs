use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const MODEL_FILE: &str = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true";
const MODEL_SHA256: &str = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
const LOCAL_PORT: u16 = 39281;

struct RuntimeState {
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceProfile {
    os: String,
    arch: String,
    cpu: String,
    logical_cores: usize,
    ram_gb: f64,
    score: u8,
    tier: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallState {
    installed: bool,
    path: String,
    bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: f64,
}

#[derive(Clone, Serialize)]
struct ChatToken {
    content: String,
}

#[derive(Clone, Serialize)]
struct RuntimeLog {
    stream: String,
    message: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(root.join("models").join(MODEL_FILE))
}

#[tauri::command]
fn get_device_profile() -> DeviceProfile {
    let mut system = System::new_all();
    system.refresh_all();

    let logical_cores = system.cpus().len().max(1);
    let cpu = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Local processor".to_string());
    let ram_gb = system.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let os = System::long_os_version()
        .or_else(System::name)
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let arch = std::env::consts::ARCH.to_string();

    let raw_score = (ram_gb * 4.2) + (logical_cores as f64 * 2.0);
    let score = raw_score.clamp(18.0, 100.0).round() as u8;
    let (tier, reason) = if ram_gb >= 24.0 && logical_cores >= 8 {
        (
            "High local capacity",
            "This computer has room for substantially larger local models. The prototype installs a compact baseline first; Manifest's next model catalog can route this tier to larger reasoning and coding models automatically.",
        )
    } else if ram_gb >= 12.0 {
        (
            "Balanced local capacity",
            "This computer is a strong fit for local AI. Manifest is starting with a compact, responsive baseline and can expand the installed intelligence as the automatic model catalog grows.",
        )
    } else {
        (
            "Efficient local capacity",
            "Manifest selected a compact model designed to keep memory use and startup time practical on this computer.",
        )
    };

    DeviceProfile {
        os,
        arch,
        cpu,
        logical_cores,
        ram_gb,
        score,
        tier: tier.to_string(),
        reason: reason.to_string(),
    }
}

#[tauri::command]
fn get_install_state(app: AppHandle) -> Result<InstallState, String> {
    let path = model_path(&app)?;
    let metadata = fs::metadata(&path).ok();
    let bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    Ok(InstallState {
        installed: metadata.is_some() && bytes > 900_000_000,
        path: path.to_string_lossy().to_string(),
        bytes,
    })
}

#[tauri::command]
async fn install_recommended_model(app: AppHandle) -> Result<InstallState, String> {
    let path = model_path(&app)?;
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() > 900_000_000 {
            return Ok(InstallState {
                installed: true,
                path: path.to_string_lossy().to_string(),
                bytes: metadata.len(),
            });
        }
    }

    let parent = path.parent().ok_or("Invalid model path")?;
    fs::create_dir_all(parent).map_err(|e| format!("Could not create model directory: {e}"))?;
    let temp = path.with_extension("gguf.part");
    if temp.exists() {
        let _ = fs::remove_file(&temp);
    }

    let client = reqwest::Client::builder()
        .user_agent("Manifest-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Model download could not start: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Model host returned HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded = 0u64;
    let mut file = File::create(&temp).map_err(|e| format!("Could not create model file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("Could not write model file: {e}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let percent = if total > 0 {
            downloaded as f64 * 100.0 / total as f64
        } else {
            0.0
        };
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress {
                downloaded,
                total,
                percent,
            },
        );
    }

    file.sync_all().map_err(|e| format!("Could not finalize model file: {e}"))?;
    drop(file);

    let digest = format!("{:x}", hasher.finalize());
    if digest != MODEL_SHA256 {
        let _ = fs::remove_file(&temp);
        return Err("Downloaded model failed its integrity check. Please try again.".to_string());
    }

    fs::rename(&temp, &path).map_err(|e| format!("Could not install model: {e}"))?;
    let bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(downloaded);
    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            downloaded: bytes,
            total: bytes,
            percent: 100.0,
        },
    );

    Ok(InstallState {
        installed: true,
        path: path.to_string_lossy().to_string(),
        bytes,
    })
}

async fn runtime_is_ready() -> bool {
    reqwest::Client::new()
        .get(format!("http://127.0.0.1:{LOCAL_PORT}/health"))
        .timeout(Duration::from_secs(1))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[tauri::command]
async fn start_local_ai(
    app: AppHandle,
    state: State<'_, RuntimeState>,
) -> Result<String, String> {
    if runtime_is_ready().await {
        return Ok("ready".to_string());
    }

    let model = model_path(&app)?;
    if !model.exists() {
        return Err("Install your local AI before starting Manifest.".to_string());
    }

    if let Some(old_child) = state.child.lock().map_err(|_| "Runtime state unavailable")?.take() {
        let _ = old_child.kill();
    }

    let model_arg = model.to_string_lossy().to_string();
    let mut args = vec![
        "-m".to_string(),
        model_arg,
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        LOCAL_PORT.to_string(),
        "-c".to_string(),
        "4096".to_string(),
        "--parallel".to_string(),
        "1".to_string(),
    ];
    if cfg!(target_os = "macos") {
        args.push("-ngl".to_string());
        args.push("99".to_string());
    }

    let command = app
        .shell()
        .sidecar("llama-server")
        .map_err(|e| format!("Bundled AI runtime is unavailable: {e}"))?
        .args(args);
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("Could not start the bundled AI runtime: {e}"))?;

    *state.child.lock().map_err(|_| "Runtime state unavailable")? = Some(child);
    let log_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(bytes) => {
                    let _ = log_app.emit(
                        "runtime-log",
                        RuntimeLog {
                            stream: "stdout".into(),
                            message: String::from_utf8_lossy(&bytes).to_string(),
                        },
                    );
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(bytes) => {
                    let _ = log_app.emit(
                        "runtime-log",
                        RuntimeLog {
                            stream: "stderr".into(),
                            message: String::from_utf8_lossy(&bytes).to_string(),
                        },
                    );
                }
                _ => {}
            }
        }
    });

    for _ in 0..120 {
        if runtime_is_ready().await {
            return Ok("ready".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err("The local model did not finish starting within one minute. Try Start Manifest again.".to_string())
}

#[tauri::command]
fn stop_local_ai(state: State<'_, RuntimeState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().map_err(|_| "Runtime state unavailable")?.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn chat(app: AppHandle, messages: Vec<ChatMessage>) -> Result<(), String> {
    if !runtime_is_ready().await {
        return Err("The local AI runtime is not ready.".to_string());
    }

    let payload = serde_json::json!({
        "model": "manifest-local",
        "messages": messages,
        "stream": true,
        "temperature": 0.7,
        "max_tokens": 1200
    });

    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{LOCAL_PORT}/v1/chat/completions"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Local inference request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Local runtime returned HTTP {status}: {detail}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Local response was interrupted: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim().to_string();
            buffer.drain(..=newline);
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("chat-done", ());
                    return Ok(());
                }
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = value
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !content.is_empty() {
                            let _ = app.emit(
                                "chat-token",
                                ChatToken {
                                    content: content.to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("chat-done", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RuntimeState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_device_profile,
            get_install_state,
            install_recommended_model,
            start_local_ai,
            stop_local_ai,
            chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running Manifest");
}
