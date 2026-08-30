-- Scope employee identity uniqueness to a batch.
-- Run once on an existing database before deploying the matching backend.
-- The previous global unique key guarantees this migration cannot encounter
-- duplicate rows when the new batch-scoped key is created.

ALTER TABLE up_emp
  DROP INDEX UK_EMP_MERIT_CLASS,
  ADD UNIQUE KEY UK_EMP_BATCH_MERIT_CLASS
    (batch_no, MERITLIST_ID, CLASS_ID);
