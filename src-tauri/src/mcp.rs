//! MCP servers: importing the ones the user already has, and handing a
//! selection to a spawned session.
//!
//! Canvastrator never edits the user's own MCP config. Servers are passed per
//! invocation with `--mcp-config`, so attaching one on a canvas adds it to that
//! session only and leaves everything else alone.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    /// "stdio" or "http"
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Where it was imported from, for the UI to show.
    #[serde(default)]
    pub source: String,
}

fn parse_servers(json: &serde_json::Value, source: &str, out: &mut Vec<McpServer>) {
    let Some(map) = json.get("mcpServers").and_then(|v| v.as_object()) else {
        return;
    };
    for (name, cfg) in map {
        let url = cfg.get("url").and_then(|v| v.as_str()).map(str::to_string);
        let command = cfg.get("command").and_then(|v| v.as_str()).map(str::to_string);
        // An explicit type wins; otherwise a url means http and a command means stdio.
        let transport = cfg
            .get("type")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() });

        out.push(McpServer {
            name: name.clone(),
            transport,
            command,
            args: cfg
                .get("args")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str()).map(str::to_string).collect())
                .unwrap_or_default(),
            url,
            source: source.to_string(),
        });
    }
}

/// MCP servers already configured on this machine, so nobody has to retype one.
#[tauri::command]
pub fn discover_mcp_servers(cwd: Option<String>) -> Vec<McpServer> {
    let mut out = vec![];
    let home = std::env::var_os("HOME").map(PathBuf::from);

    if let Some(home) = &home {
        for (path, label) in [
            (home.join(".claude.json"), "claude"),
            (home.join(".claude/settings.json"), "claude settings"),
            // Deliberately NOT ~/Library/Application Support/Claude: reading
            // another app's container triggers a macOS privacy prompt, and
            // every server defined there is already in ~/.claude.json.
        ] {
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    parse_servers(&json, label, &mut out);

                    // ~/.claude.json also keeps per-project servers, keyed by
                    // the project path. Only this project's are relevant.
                    if let (Some(cwd), Some(projects)) =
                        (cwd.as_ref(), json.get("projects").and_then(|v| v.as_object()))
                    {
                        if let Some(entry) = projects.get(cwd) {
                            parse_servers(entry, "project", &mut out);
                        }
                    }
                }
            }
        }
    }

    if let Some(cwd) = &cwd {
        if let Ok(text) = std::fs::read_to_string(PathBuf::from(cwd).join(".mcp.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                parse_servers(&json, "project", &mut out);
            }
        }
    }

    // A server defined in several places is still one server.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out.dedup_by(|a, b| a.name == b.name);
    out
}

/// The `--mcp-config` payload for a set of servers.
///
/// Returns None for an empty set so the caller can leave the flag off entirely
/// rather than passing an empty object.
pub fn config_json(servers: &[McpServer]) -> Option<String> {
    if servers.is_empty() {
        return None;
    }
    let mut map = BTreeMap::new();
    for s in servers {
        let mut cfg = serde_json::Map::new();
        cfg.insert("type".into(), serde_json::json!(s.transport));
        if let Some(url) = &s.url {
            cfg.insert("url".into(), serde_json::json!(url));
        }
        if let Some(command) = &s.command {
            cfg.insert("command".into(), serde_json::json!(command));
        }
        if !s.args.is_empty() {
            cfg.insert("args".into(), serde_json::json!(s.args));
        }
        map.insert(s.name.clone(), serde_json::Value::Object(cfg));
    }
    serde_json::to_string(&serde_json::json!({ "mcpServers": map })).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn http(name: &str) -> McpServer {
        McpServer {
            name: name.into(),
            transport: "http".into(),
            command: None,
            args: vec![],
            url: Some("https://example.com/mcp".into()),
            source: "test".into(),
        }
    }

    #[test]
    fn infers_transport_from_the_shape_when_it_is_not_stated() {
        let json = serde_json::json!({
            "mcpServers": {
                "remote": { "url": "https://x/mcp" },
                "local": { "command": "/bin/thing", "args": ["--flag"] }
            }
        });
        let mut out = vec![];
        parse_servers(&json, "test", &mut out);
        out.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(out[0].name, "local");
        assert_eq!(out[0].transport, "stdio");
        assert_eq!(out[0].args, vec!["--flag".to_string()]);
        assert_eq!(out[1].transport, "http");
    }

    #[test]
    fn an_explicit_type_wins_over_the_guess() {
        let json = serde_json::json!({ "mcpServers": { "a": { "type": "sse", "url": "https://x" } } });
        let mut out = vec![];
        parse_servers(&json, "test", &mut out);
        assert_eq!(out[0].transport, "sse");
    }

    #[test]
    fn config_json_is_what_the_cli_expects() {
        let json = config_json(&[http("flowiki")]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["mcpServers"]["flowiki"]["type"], "http");
        assert_eq!(v["mcpServers"]["flowiki"]["url"], "https://example.com/mcp");
    }

    /// Passing `--mcp-config {}` would be a pointless flag; leave it off.
    #[test]
    fn no_servers_means_no_flag() {
        assert!(config_json(&[]).is_none());
    }

    #[test]
    fn a_stdio_server_keeps_its_command_and_args() {
        let s = McpServer {
            name: "pencil".into(),
            transport: "stdio".into(),
            command: Some("/bin/pencil".into()),
            args: vec!["--app".into(), "desktop".into()],
            url: None,
            source: "test".into(),
        };
        let v: serde_json::Value = serde_json::from_str(&config_json(&[s]).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["pencil"]["command"], "/bin/pencil");
        assert_eq!(v["mcpServers"]["pencil"]["args"][1], "desktop");
        assert!(v["mcpServers"]["pencil"].get("url").is_none());
    }

    #[test]
    fn malformed_config_is_ignored_rather_than_fatal() {
        let mut out = vec![];
        parse_servers(&serde_json::json!({ "mcpServers": "nope" }), "t", &mut out);
        parse_servers(&serde_json::json!({}), "t", &mut out);
        assert!(out.is_empty());
    }
}
