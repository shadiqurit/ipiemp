-- Add role-based administrator access to an existing database.
-- Existing administrators are promoted so this migration cannot lock everyone
-- out of user management. Super Admins can later change individual roles.
ALTER TABLE admin_user
  ADD COLUMN USER_TYPE ENUM('ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'ADMIN'
  AFTER DISPLAY_NAME;

UPDATE admin_user SET USER_TYPE = 'SUPER_ADMIN';
