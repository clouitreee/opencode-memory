use clap::{Parser, Subcommand};
use std::io::{self, BufRead};
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

use longmem::LongMem;

#[derive(Parser)]
#[command(name = "longmem")]
#[command(about = "Local memory layer for terminal-based AI workflows", long_about = None)]
struct Cli {
    #[arg(short, long, global = true, env = "LONGMEM_PATH", help = "Custom storage path")]
    path: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize LongMem state with an optional project
    Init {
        /// Project name to associate with memories
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Capture a conversation turn (user input + model output)
    Capture {
        /// User input/question
        #[arg(short = 'u', long = "user", required = true)]
        user_input: String,
        /// Model/assistant response
        #[arg(short = 'm', long = "model", required = true)]
        model_output: String,
        /// Project name (overrides default)
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Search for relevant memories
    Retrieve {
        /// Search query
        #[arg(short, long, required = true)]
        query: String,
        /// Maximum number of results
        #[arg(short, long, default_value = "10")]
        limit: usize,
        /// Filter by project name
        #[arg(short, long)]
        project: Option<String>,
    },
    /// List all stored memories
    List {
        /// Filter by project name
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Show memory statistics
    Stats {},
    /// Delete a memory by ID
    Delete {
        /// Memory ID to delete
        id: String,
    },
    /// Watch stdin and extract memories automatically
    Watch {
        /// Project name to associate with memories
        #[arg(short, long)]
        project: Option<String>,
        /// Suppress output
        #[arg(short, long)]
        quiet: bool,
    },
    /// Get relevant context for a task
    Context {
        /// Task description
        #[arg(short, long, required = true)]
        task: String,
        /// Maximum number of memories to include
        #[arg(short, long, default_value = "10")]
        limit: usize,
        /// Filter by project name
        #[arg(short, long)]
        project: Option<String>,
    },
}

const SECRET_PATTERNS: &[&str] = &[
    r"(?i)\b(api_key|apikey|api-key)\s*[:=]\s*['\"]?[\w-]{20,}",
    r"(?i)\b(password|passwd|pwd)\s*[:=]\s*['\"]?[\S]{8,}",
    r"(?i)\b(secret|token|auth)\s*[:=]\s*['\"]?[\w-]{20,}",
    r"(?i)\b(private_key|privatekey)\s*[:=]",
    r"(?i)\b(bearer\s+[\w-]{20,})",
    r"(?i)\b(aws_access_key|aws_secret)\s*[:=]",
];

fn contains_secrets(text: &str) -> bool {
    for pattern in SECRET_PATTERNS {
        if let Ok(re) = regex::Regex::new(pattern) {
            if re.is_match(text) {
                return true;
            }
        }
    }
    false
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("longmem=info".parse().unwrap()),
        )
        .init();

    let cli = Cli::parse();

    let mut longmem = match LongMem::new(cli.path) {
        Ok(lm) => lm,
        Err(e) => {
            eprintln!("Error: failed to initialize LongMem: {}", e);
            std::process::exit(1);
        }
    };

    match cli.command {
        Commands::Init { project } => {
            if let Some(p) = project {
                longmem.set_project(&p);
                if let Err(e) = longmem.storage.config_mut().persist_config() {
                    eprintln!("Warning: failed to persist config: {}", e);
                }
                println!("Initialized LongMem for project: {}", p);
            } else {
                println!("Initialized LongMem (no project set)");
            }
        }

        Commands::Capture {
            user_input,
            model_output,
            project,
        } => {
            if let Some(p) = project {
                longmem.set_project(&p);
            }
            let memories = longmem.capture_turn(&user_input, &model_output);
            if memories.is_empty() {
                println!("No memories captured");
            } else {
                println!("Captured {} memory(ies):", memories.len());
                for mem in &memories {
                    let preview = if mem.content.len() > 60 {
                        format!("{}...", &mem.content[..60])
                    } else {
                        mem.content.clone()
                    };
                    println!("  [{}] {}", &mem.id[..8], preview);
                }
            }
        }

        Commands::Retrieve {
            query,
            limit,
            project,
        } => {
            if let Some(p) = project {
                longmem.set_project(&p);
            }
            let memories = longmem.retrieve(&query, limit);
            if memories.is_empty() {
                println!("No relevant memories found for: {}", query);
            } else {
                let context = longmem.build_context(&memories);
                println!("{}", context);
            }
        }

        Commands::List { project } => {
            let memories = if let Some(ref p) = project {
                longmem.set_project(p);
                longmem
                    .list_memories()
                    .into_iter()
                    .filter(|m| m.project.as_deref() == Some(p))
                    .collect()
            } else {
                longmem.list_memories()
            };

            if memories.is_empty() {
                println!("No memories stored");
            } else {
                println!("Stored memories ({} total):", memories.len());
                for mem in &memories {
                    let preview = if mem.content.len() > 60 {
                        format!("{}...", &mem.content[..60])
                    } else {
                        mem.content.clone()
                    };
                    println!(
                        "[{}] {} - {}: {}",
                        &mem.id[..8],
                        mem.created_at.format("%Y-%m-%d"),
                        format!("{:?}", mem.memory_type).to_lowercase(),
                        preview
                    );
                }
            }
        }

        Commands::Stats {} => {
            let stats = longmem.stats();
            println!("Total memories: {}", stats.total_memories);
            println!("By type:");
            for (t, c) in &stats.by_type {
                println!("  {}: {}", t, c);
            }
            if let Some(p) = stats.project {
                println!("Project: {}", p);
            }
            if let Some(s) = stats.current_session {
                println!("Session: {}", &s[..8]);
            }
        }

        Commands::Delete { id } => {
            match longmem.delete_memory(&id) {
                Ok(()) => println!("Deleted memory: {}", &id[..8]),
                Err(e) => {
                    eprintln!("Error: {}", e);
                    std::process::exit(1);
                }
            }
        }

        Commands::Watch { project, quiet } => {
            if let Some(p) = project {
                longmem.set_project(&p);
            }

            let stdin = io::stdin();
            let mut total_captured = 0;
            let mut buffer = String::new();

            for line in stdin.lock().lines() {
                match line {
                    Ok(text) => {
                        buffer.push_str(&text);
                        buffer.push('\n');

                        if buffer.len() > 512 {
                            if contains_secrets(&buffer) {
                                if !quiet {
                                    eprintln!("Warning: potential secrets detected, skipping");
                                }
                                buffer.clear();
                                continue;
                            }

                            let memories = longmem.capture_turn(&buffer, "");
                            total_captured += memories.len();

                            if !quiet && !memories.is_empty() {
                                for mem in &memories {
                                    let preview = if mem.content.len() > 50 {
                                        format!("{}...", &mem.content[..50])
                                    } else {
                                        mem.content.clone()
                                    };
                                    eprintln!("[watch] captured: {}", preview);
                                }
                            }
                            buffer.clear();
                        }
                    }
                    Err(e) => {
                        if !quiet {
                            eprintln!("Error reading stdin: {}", e);
                        }
                        break;
                    }
                }
            }

            if !buffer.trim().is_empty() {
                if contains_secrets(&buffer) {
                    if !quiet {
                        eprintln!("Warning: potential secrets detected, skipping");
                    }
                } else {
                    let memories = longmem.capture_turn(&buffer, "");
                    total_captured += memories.len();

                    if !quiet && !memories.is_empty() {
                        for mem in &memories {
                            let preview = if mem.content.len() > 50 {
                                format!("{}...", &mem.content[..50])
                            } else {
                                mem.content.clone()
                            };
                            eprintln!("[watch] captured: {}", preview);
                        }
                    }
                }
            }

            if !quiet {
                eprintln!("[watch] total memories captured: {}", total_captured);
            }
        }

        Commands::Context {
            task,
            limit,
            project,
        } => {
            if let Some(p) = project {
                longmem.set_project(&p);
            }
            let memories = longmem.retrieve(&task, limit);
            if memories.is_empty() {
                // Empty output, no context found
            } else {
                let context = longmem.build_context(&memories);
                println!("{}", context);
            }
        }
    }
}
