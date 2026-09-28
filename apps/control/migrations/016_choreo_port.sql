-- Lease a published host port for choreo-server, so the Choreo pane works in
-- port mode - which is every fleet worker (decision 048) as well as
-- `bun run dev:control`. Network mode keeps reaching it by container name.
ALTER TABLE container_leases ADD COLUMN choreo_port INTEGER;

CREATE UNIQUE INDEX idx_container_leases_choreo_port_unique
  ON container_leases(choreo_port) WHERE choreo_port IS NOT NULL;
