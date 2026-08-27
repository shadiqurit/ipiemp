-- Run once on an existing MySQL/Aiven database.
-- It renumbers each employee's education rows from 1 and makes the pair
-- (EMP_ENTRY_ID, SLNO) the primary key.

ALTER TABLE hr_empexamdet
  MODIFY SLNO BIGINT NOT NULL,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (EMP_ENTRY_ID, SLNO);

UPDATE hr_empexamdet AS target
JOIN (
  SELECT old_slno, EMP_ENTRY_ID,
         ROW_NUMBER() OVER (PARTITION BY EMP_ENTRY_ID ORDER BY old_slno) AS new_slno
    FROM (
      SELECT SLNO AS old_slno, EMP_ENTRY_ID
        FROM hr_empexamdet
    ) AS source_rows
) AS numbered
  ON numbered.old_slno = target.SLNO
 AND numbered.EMP_ENTRY_ID = target.EMP_ENTRY_ID
SET target.SLNO = numbered.new_slno;
