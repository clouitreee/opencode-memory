use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tracing_subscriber::EnvFilter;

use longmem::LongMem;

#[derive(Parser)]
#[command(name = "longmem")]
#[command(about = "Memoria a largo plazo para modelos de terminal", long_about = None)]
struct Cli {
    #[arg(short, long, global = true)]
    path: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Inicializar LongMem con un proyecto
    Init {
        /// Nombre del proyecto
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Capturar un turno de conversación
    Capture {
        /// Input del usuario
        #[arg(short = 'u', long = "user")]
        user_input: String,
        /// Output del modelo
        #[arg(short = 'm', long = "model")]
        model_output: String,
        /// Proyecto al que pertenece
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Recuperar memorias relevantes
    Retrieve {
        /// Query de búsqueda
        #[arg(short, long)]
        query: String,
        /// Número de resultados
        #[arg(short, long, default_value = "10")]
        limit: usize,
        /// Proyecto específico
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Listar todas las memorias
    List {
        /// Filtrar por proyecto
        #[arg(short, long)]
        project: Option<String>,
    },
    /// Ver estadísticas
    Stats {},
    /// Eliminar una memoria
    Delete {
        /// ID de la memoria
        id: String,
    },
    /// Consolidar memorias (limpiar obsoletas)
    Consolidate {},
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("longmem=info".parse().unwrap()))
        .init();

    let cli = Cli::parse();

    let mut longmem = match LongMem::new(cli.path) {
        Ok(lm) => lm,
        Err(e) => {
            eprintln!("Error inicializando LongMem: {}", e);
            std::process::exit(1);
        }
    };

    match cli.command {
        Commands::Init { project } => {
            if let Some(p) = project {
                longmem.set_project(&p);
                println!("LongMem inicializado para proyecto: {}", p);
            } else {
                println!("LongMem inicializado (sin proyecto)");
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
            println!("Capturadas {} memorias", memories.len());
            for mem in memories {
                println!("  - [{}] {}", &mem.id[..8], &mem.content[..mem.content.len().min(60)]);
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
                println!("No se encontraron memorias relevantes");
            } else {
                let context = longmem.build_context(&memories);
                println!("{}", context);
            }
        }

        Commands::List { project } => {
            let memories = if let Some(p) = project {
                longmem.set_project(&p);
                longmem
                    .list_memories()
                    .into_iter()
                    .filter(|m| m.project.as_deref() == Some(&p))
                    .collect()
            } else {
                longmem.list_memories()
            };

            if memories.is_empty() {
                println!("No hay memorias guardadas");
            } else {
                for mem in memories {
                    println!(
                        "[{}] {} - {}: {}",
                        &mem.id[..8],
                        mem.created_at.format("%Y-%m-%d"),
                        format!("{:?}", mem.memory_type).to_lowercase(),
                        &mem.content[..mem.content.len().min(80)]
                    );
                }
            }
        }

        Commands::Stats {} => {
            let stats = longmem.stats();
            println!("Total de memorias: {}", stats.total_memories);
            println!("Por tipo:");
            for (t, c) in &stats.by_type {
                println!("  {}: {}", t, c);
            }
            println!("Proyecto actual: {:?}", stats.project);
            println!("Sesión: {}", stats.current_session.unwrap_or_default());
        }

        Commands::Delete { id } => {
            match longmem.delete_memory(&id) {
                Ok(()) => println!("Memoria {} eliminada", &id[..8]),
                Err(e) => eprintln!("Error: {}", e),
            }
        }

        Commands::Consolidate {} => {
            println!("Consolidación ejecutada (MVP: sin implementación aún)");
        }
    }
}