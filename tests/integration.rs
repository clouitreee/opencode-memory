mod integration_tests {
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::io::Write;
    use tempfile::TempDir;

    fn binary_path() -> PathBuf {
        PathBuf::from(env!("CARGO_BIN_EXE_longmem"))
    }

    fn run_longmem(args: &[&str], storage_path: &PathBuf) -> (bool, String, String) {
        let output = Command::new(binary_path())
            .args(args)
            .arg("--path")
            .arg(storage_path)
            .output()
            .expect("Failed to execute longmem");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }

    fn run_longmem_with_stdin(
        args: &[&str],
        storage_path: &PathBuf,
        stdin_data: &str,
    ) -> (bool, String, String) {
        let mut child = Command::new(binary_path())
            .args(args)
            .arg("--path")
            .arg(storage_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Failed to spawn longmem");

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(stdin_data.as_bytes()).expect("Failed to write to stdin");
        }

        let output = child.wait_with_output().expect("Failed to wait for longmem");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }

    #[test]
    fn test_init_creates_storage() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        let (success, stdout, _) = run_longmem(&["init", "--project", "test-project"], &storage_path);

        assert!(success, "init should succeed");
        assert!(stdout.contains("test-project"));
        assert!(storage_path.exists());
    }

    #[test]
    fn test_watch_stores_memory() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);

        let input = "I got error 502 on nginx. Fixed by running sudo systemctl restart nginx\n";
        let (success, _, stderr) = run_longmem_with_stdin(&["watch"], &storage_path, input);

        assert!(success, "watch should succeed");
        assert!(stderr.contains("captured") || stderr.contains("memories"), "watch should report captures");

        let (success_list, stdout_list, _) = run_longmem(&["list"], &storage_path);
        assert!(success_list);
        assert!(stdout_list.contains("error") || stdout_list.contains("nginx"), "list should show stored memory");
    }

    #[test]
    fn test_context_retrieves_relevant_memory() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        let input = "Port 8080 was blocked. Changed to port 3000.\n";
        run_longmem_with_stdin(&["watch"], &storage_path, input);

        let (success, stdout, _) = run_longmem(&["context", "--task", "port configuration"], &storage_path);

        assert!(success, "context should succeed");
        assert!(stdout.contains("MEMORY CONTEXT"), "context should be clearly marked");
        assert!(stdout.contains("port") || stdout.contains("8080") || stdout.contains("3000"), "context should contain relevant memory");
    }

    #[test]
    fn test_secret_filtering() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);

        let input = "Config: password = supersecret123\n";
        run_longmem_with_stdin(&["watch"], &storage_path, input);

        let memories_dir = storage_path.join("memories");
        if memories_dir.exists() {
            for entry in fs::read_dir(&memories_dir).unwrap() {
                let entry = entry.unwrap();
                let content = fs::read_to_string(entry.path()).unwrap();
                assert!(!content.contains("supersecret123"), "Secret should be redacted");
            }
        }
    }

    #[test]
    fn test_empty_input_safe() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);

        let (success, _, _) = run_longmem_with_stdin(&["watch"], &storage_path, "");
        assert!(success, "Empty input should not crash");

        let (success2, _, _) = run_longmem(&["context", "--task", "xyz123nothing"], &storage_path);
        assert!(success2, "Empty retrieval should not panic");
    }

    #[test]
    fn test_capture_command_works() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);

        let (success, stdout, _) = run_longmem(
            &["capture", "-u", "Test question", "-m", "Test answer with `some-command`"],
            &storage_path,
        );

        assert!(success, "capture should succeed");
        assert!(stdout.contains("Captured") || stdout.contains("memory"), "capture should report success");
    }

    #[test]
    fn test_retrieve_command_works() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem(
            &["capture", "-u", "nginx error 502", "-m", "run nginx -t"],
            &storage_path,
        );

        let (success, stdout, _) = run_longmem(&["retrieve", "--query", "nginx"], &storage_path);

        assert!(success, "retrieve should succeed");
        assert!(stdout.contains("MEMORY CONTEXT"), "retrieve should return marked context");
    }

    #[test]
    fn test_list_command_works() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem(&["capture", "-u", "test", "-m", "response"], &storage_path);

        let (success, stdout, _) = run_longmem(&["list"], &storage_path);

        assert!(success, "list should succeed");
        assert!(stdout.contains("Stored memories"), "list should show memories");
    }

    #[test]
    fn test_stats_command_works() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem(&["capture", "-u", "test", "-m", "response"], &storage_path);

        let (success, stdout, _) = run_longmem(&["stats"], &storage_path);

        assert!(success, "stats should succeed");
        assert!(stdout.contains("Total memories"), "stats should show count");
    }

    #[test]
    fn test_context_marking_preserved() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem_with_stdin(&["watch"], &storage_path, "Error: disk full. Deleted temp files.\n");

        let (_, stdout, _) = run_longmem(&["context", "--task", "disk error"], &storage_path);

        assert!(stdout.contains("MEMORY CONTEXT"), "Context should have header");
        assert!(stdout.contains("END MEMORY CONTEXT"), "Context should have footer");
        assert!(stdout.contains("not system instruction"), "Context should warn against treating as instructions");
    }

    #[test]
    fn test_persistence_across_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem(&["capture", "-u", "persistent test", "-m", "this should persist"], &storage_path);

        let (success, stdout, _) = run_longmem(&["list"], &storage_path);
        assert!(success, "List in new session should succeed");
        assert!(stdout.contains("persistent"), "Memory should persist across sessions");
    }

    #[test]
    #[cfg(unix)]
    fn test_storage_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let storage_path = temp_dir.path().to_path_buf();

        run_longmem(&["init"], &storage_path);
        run_longmem(&["capture", "-u", "test", "-m", "response"], &storage_path);

        let metadata = fs::metadata(&storage_path).unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(mode & 0o777, 0o700, "Storage dir should have 700 permissions");

        let memories_path = storage_path.join("memories");
        let mem_metadata = fs::metadata(&memories_path).unwrap();
        let mem_mode = mem_metadata.permissions().mode();
        assert_eq!(mem_mode & 0o777, 0o700, "Memories dir should have 700 permissions");
    }
}
