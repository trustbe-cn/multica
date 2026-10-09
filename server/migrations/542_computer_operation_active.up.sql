CREATE UNIQUE INDEX CONCURRENTLY computer_operation_active ON computer_operation(computer_id,username) WHERE state IN ('queued','running');
