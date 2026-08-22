//! What the user's plan has left, as opposed to what the tokens would cost.
//!
//! A dollar total is the wrong unit for almost everyone running this app. On a
//! Claude subscription nothing is billed per token: you pay monthly and are
//! metered against rolling windows — a five-hour session window and a weekly
//! one — and the number that actually stops a squad mid-run is how full those
//! are, not what the turns would have cost at API rates.
//!
//! Claude Code answers that over its control protocol: the `get_usage` request
//! that backs its own `/usage` view. It costs no tokens (no model is called),
//! takes about a second, and returns plan utilisation straight from the
//! `anthropic-ratelimit-unified-*` headers the CLI has been collecting.
//!
//! The response is marked experimental by the CLI — "the response shape may
//! change" — so everything here is parsed defensively: a field we do not
//! recognise is skipped, and a shape we cannot read at all becomes "no plan
//! data" rather than an error the user has to dismiss.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::env;

/// One metered window, flattened into what a bar needs to draw itself.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Stable key: `session`, `weekly`, or the scoped bucket's own name.
    pub kind: String,
    /// What to call it on screen.
    pub label: String,
    /// 0–100. The CLI reports whole percents.
    pub percent: f64,
    /// ISO 8601, or None for a window that has never been touched.
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanUsage {
    /// False when plan limits do not apply — an API key, Bedrock, Vertex, or a
    /// CLI too old to answer. The panel falls back to money in that case,
    /// which is the honest unit there.
    pub available: bool,
    /// `pro`, `max`, `team`, `enterprise`, or None for API-key auth.
    pub subscription: Option<String>,
    pub windows: Vec<UsageWindow>,
    /// Why there is nothing to show, for the panel to say out loud.
    pub reason: Option<String>,
}

impl PlanUsage {
    fn none(reason: &str) -> Self {
        PlanUsage {
            available: false,
            subscription: None,
            windows: vec![],
            reason: Some(reason.to_string()),
        }
    }
}

/// Human label for a bucket the CLI names in snake_case.
fn label_for(kind: &str, scope: Option<&str>) -> String {
    match kind {
        "session" | "five_hour" => "session".into(),
        "weekly_all" | "seven_day" => "weekly".into(),
        "weekly_scoped" => match scope {
            Some(model) => format!("{model} weekly"),
            None => "weekly, scoped".into(),
        },
        // An unreleased or renamed bucket: show it rather than drop it, but do
        // not pretend to know what it is called.
        other => other.replace('_', " "),
    }
}

/// The scoped bucket's model name, where the server supplied one.
fn scope_of(entry: &Value) -> Option<&str> {
    entry
        .get("scope")?
        .get("model")?
        .get("display_name")?
        .as_str()
}

/// The normalised `limits` array, which is the shape the CLI's own view uses.
fn windows_from_limits(limits: &[Value]) -> Vec<UsageWindow> {
    limits
        .iter()
        .filter_map(|l| {
            let kind = l.get("kind").and_then(Value::as_str)?;
            let percent = l.get("percent").and_then(Value::as_f64)?;
            Some(UsageWindow {
                label: label_for(kind, scope_of(l)),
                kind: kind.to_string(),
                percent,
                resets_at: l
                    .get("resets_at")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

/// The older per-bucket objects, for a CLI that has no `limits` array yet.
fn windows_from_buckets(rate_limits: &Value) -> Vec<UsageWindow> {
    ["five_hour", "seven_day"]
        .iter()
        .filter_map(|key| {
            let b = rate_limits.get(key)?;
            let percent = b.get("utilization").and_then(Value::as_f64)?;
            Some(UsageWindow {
                kind: (*key).to_string(),
                label: label_for(key, None),
                percent,
                resets_at: b
                    .get("resets_at")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect()
}

fn parse(response: &Value) -> PlanUsage {
    let subscription = response
        .get("subscription_type")
        .and_then(Value::as_str)
        .map(str::to_string);

    let available = response
        .get("rate_limits_available")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let Some(rate_limits) = response.get("rate_limits").filter(|v| !v.is_null()) else {
        return PlanUsage {
            available: false,
            subscription,
            windows: vec![],
            reason: Some("this login is billed per token, not on a plan".into()),
        };
    };

    let windows = match rate_limits.get("limits").and_then(Value::as_array) {
        Some(limits) => windows_from_limits(limits),
        None => windows_from_buckets(rate_limits),
    };

    let empty = windows.is_empty();
    PlanUsage {
        available: available && !empty,
        subscription,
        windows,
        reason: empty.then(|| "the CLI reported no windows".into()),
    }
}

/// Ask Claude Code what the plan has left.
///
/// One short-lived process per call: the control protocol wants a stream on
/// stdin, and GridTerm runs one process per turn rather than holding a session
/// open, so there is no existing channel to borrow. Closing stdin after the
/// single request is what makes the CLI answer and exit.
#[tauri::command]
pub async fn plan_usage() -> PlanUsage {
    let Some(exe) = env::which("claude") else {
        return PlanUsage::none("claude is not on your PATH");
    };

    let spawned = Command::new(&exe)
        .args([
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .env("PATH", env::user_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn();

    let Ok(mut child) = spawned else {
        return PlanUsage::none("could not run claude");
    };

    if let Some(mut stdin) = child.stdin.take() {
        let req = br#"{"type":"control_request","request_id":"gt-usage","request":{"subtype":"get_usage"}}"#;
        let _ = stdin.write_all(req).await;
        let _ = stdin.write_all(b"\n").await;
        // Dropped, not just flushed: the CLI reads until end of input.
        let _ = stdin.shutdown().await;
    }

    let stdout = child.stdout.take().expect("stdout piped");
    let read = async {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if v.get("type").and_then(Value::as_str) != Some("control_response") {
                continue;
            }
            let resp = v.get("response");
            let inner = resp.and_then(|r| r.get("response"));
            return match inner {
                Some(body) => parse(body),
                // A control_response that is not a success: the CLI knows the
                // request and refused it, usually for auth.
                None => PlanUsage::none("claude declined to report usage"),
            };
        }
        PlanUsage::none("claude reported no usage")
    };

    // Generous, because a cold CLI resolves auth before answering; bounded,
    // because a panel must never wait on a process that has hung.
    let out = tokio::time::timeout(Duration::from_secs(20), read)
        .await
        .unwrap_or_else(|_| PlanUsage::none("claude did not answer in time"));
    let _ = child.kill().await;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(json: &str) -> Value {
        serde_json::from_str(json).expect("test fixture parses")
    }

    #[test]
    fn reads_the_normalised_limits_array() {
        let got = parse(&body(
            r#"{
              "subscription_type": "max",
              "rate_limits_available": true,
              "rate_limits": {
                "limits": [
                  {"kind":"session","percent":12,"resets_at":"2026-08-21T07:29:59Z"},
                  {"kind":"weekly_all","percent":9,"resets_at":"2026-08-26T21:59:59Z"},
                  {"kind":"weekly_scoped","percent":0,"resets_at":null,
                   "scope":{"model":{"display_name":"Fable"}}}
                ]
              }
            }"#,
        ));
        assert!(got.available);
        assert_eq!(got.subscription.as_deref(), Some("max"));
        assert_eq!(
            got.windows.iter().map(|w| w.label.as_str()).collect::<Vec<_>>(),
            ["session", "weekly", "Fable weekly"]
        );
        assert_eq!(got.windows[0].percent, 12.0);
        assert_eq!(got.windows[2].resets_at, None);
    }

    #[test]
    fn falls_back_to_the_per_bucket_objects() {
        let got = parse(&body(
            r#"{
              "subscription_type": "pro",
              "rate_limits_available": true,
              "rate_limits": {
                "five_hour": {"utilization": 40, "resets_at": "2026-08-21T07:00:00Z"},
                "seven_day": {"utilization": 5, "resets_at": null},
                "seven_day_opus": null
              }
            }"#,
        ));
        assert!(got.available);
        assert_eq!(got.windows.len(), 2);
        assert_eq!(got.windows[0].percent, 40.0);
    }

    #[test]
    fn an_api_key_login_has_no_plan_to_report() {
        // The field the CLI documents for exactly this case.
        let got = parse(&body(
            r#"{"subscription_type": null, "rate_limits_available": false, "rate_limits": null}"#,
        ));
        assert!(!got.available);
        assert_eq!(got.subscription, None);
        assert!(got.reason.is_some());
    }

    #[test]
    fn an_unknown_bucket_is_shown_rather_than_dropped() {
        // The response carries buckets for unreleased plans; renaming one must
        // not make it disappear from a panel that claims to show every window.
        let got = parse(&body(
            r#"{"rate_limits_available": true,
                "rate_limits": {"limits": [{"kind":"nimbus_quill","percent":3}]}}"#,
        ));
        assert_eq!(got.windows[0].label, "nimbus quill");
        assert!(got.available);
    }

    #[test]
    fn a_shape_we_cannot_read_is_not_an_error() {
        let got = parse(&body(r#"{"rate_limits_available": true, "rate_limits": {}}"#));
        assert!(!got.available);
        assert!(got.windows.is_empty());
    }
}
