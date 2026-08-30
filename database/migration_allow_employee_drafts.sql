-- Allow incomplete new-employee drafts to be saved and resumed.
-- Run once on an existing database before deploying the matching backend.

ALTER TABLE up_emp
  MODIFY COLUMN APPROVAL_STATUS
    ENUM('DRAFT','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  MODIFY COLUMN PHONE VARCHAR(30) NULL;
