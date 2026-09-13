CREATE TABLE checkpoint_results (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    verified_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, module_id, checkpoint_id)
);
