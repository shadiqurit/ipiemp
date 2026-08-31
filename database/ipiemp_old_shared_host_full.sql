-- IPI Employee Data - Old Shared Hosting Compatible Full Database
-- Compatible target: MySQL 5.6.5+, MySQL 5.7/8.0, MariaDB 10.x
-- Main compatibility changes from MySQL 8 dump:
--   1) utf8mb4_0900_ai_ci -> utf8mb4_unicode_ci
--   2) removed LOCK TABLES and mysqldump version-specific directives
--   3) dependency-safe DROP/CREATE order
--   4) prefix lengths on wide composite indexes for older InnoDB 767-byte index limits
-- WARNING: This is a FULL REBUILD script. It DROPS the listed tables before recreating them.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;

-- ------------------------------------------------------------
-- Drop child tables first
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `hr_update_request`;
DROP TABLE IF EXISTS `hr_empfamilydet`;
DROP TABLE IF EXISTS `hr_empexamdet`;
DROP TABLE IF EXISTS `up_emp`;
DROP TABLE IF EXISTS `hr_batch_control`;
DROP TABLE IF EXISTS `admin_user`;

-- ------------------------------------------------------------
-- admin_user
-- ------------------------------------------------------------
CREATE TABLE `admin_user` (
  `USER_ID` bigint NOT NULL AUTO_INCREMENT,
  `USERNAME` varchar(100) NOT NULL,
  `PASSWORD_HASH` varchar(255) NOT NULL,
  `DISPLAY_NAME` varchar(200) DEFAULT NULL,
  `USER_TYPE` enum('ADMIN','SUPER_ADMIN') NOT NULL DEFAULT 'ADMIN',
  `ACTIVE_YN` char(1) NOT NULL DEFAULT 'Y',
  `CREATED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`USER_ID`),
  UNIQUE KEY `UK_ADMIN_USERNAME` (`USERNAME`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_user`
(`USER_ID`,`USERNAME`,`PASSWORD_HASH`,`DISPLAY_NAME`,`USER_TYPE`,`ACTIVE_YN`,`CREATED_AT`)
VALUES
(1,'sadiq','$2b$12$TU3cNVhC9GBiWaBpIeEygOwsCcgazhLIDAU/ZAL8SZ75N/Zsa82HW','Administrator','SUPER_ADMIN','Y','2026-08-27 11:50:07'),
(4,'mahmudalam','$2b$12$jxXbF7fdaMCVLkXaeaXZhOCyDPfV33348XDZASDFDVPChSlsnSkPC','Mahmud Alam','ADMIN','Y','2026-08-31 11:45:08');

ALTER TABLE `admin_user` AUTO_INCREMENT = 5;

-- ------------------------------------------------------------
-- hr_batch_control
-- ------------------------------------------------------------
CREATE TABLE `hr_batch_control` (
  `BATCH_NO` varchar(100) NOT NULL,
  `STATUS` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  `STARTED_AT` datetime DEFAULT NULL,
  `CLOSED_AT` datetime DEFAULT NULL,
  `CREATED_BY` varchar(150) DEFAULT NULL,
  `CREATED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UPDATED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`BATCH_NO`),
  KEY `IX_BATCH_STATUS` (`STATUS`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `hr_batch_control`
(`BATCH_NO`,`STATUS`,`STARTED_AT`,`CLOSED_AT`,`CREATED_BY`,`CREATED_AT`,`UPDATED_AT`)
VALUES
('BATCH-2026-01','ACTIVE','2026-08-27 12:13:13',NULL,'mahmudalam','2026-08-27 12:13:11','2026-08-31 11:46:13'),
('BATCH-2026-02','INACTIVE','2026-08-31 10:12:42','2026-08-31 11:45:59','sadiq','2026-08-31 10:12:38','2026-08-31 11:45:59');

-- ------------------------------------------------------------
-- up_emp
-- ------------------------------------------------------------
CREATE TABLE `up_emp` (
  `EMP_ENTRY_ID` bigint NOT NULL AUTO_INCREMENT,
  `MERITLIST_ID` varchar(100) NOT NULL,
  `CLASS_ID` varchar(100) NOT NULL,
  `IPI` varchar(50) DEFAULT NULL,
  `APPROVAL_STATUS` enum('DRAFT','PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'DRAFT',
  `APPROVED_BY` varchar(100) DEFAULT NULL,
  `APPROVED_AT` datetime DEFAULT NULL,
  `NAME` varchar(1000) DEFAULT NULL,
  `batch_no` varchar(100) NOT NULL,
  `BIRTHDATE` date DEFAULT NULL,
  `BLD_GROUP` varchar(30) DEFAULT NULL,
  `GENDER` char(1) DEFAULT NULL,
  `RELIGION` char(1) DEFAULT NULL,
  `NATIONALITY` varchar(50) DEFAULT NULL,
  `MARITAL_STATUS` char(1) DEFAULT NULL,
  `EMAIL` varchar(300) DEFAULT NULL,
  `PHONE` varchar(30) DEFAULT NULL,
  `PHONE1` varchar(50) DEFAULT NULL,
  `HEIGHT` varchar(300) DEFAULT NULL,
  `WEIGHT` varchar(300) DEFAULT NULL,
  `NID` varchar(30) DEFAULT NULL,
  `PERMANENT_VILLAGE` varchar(300) DEFAULT NULL,
  `PERMANENT_POST` varchar(300) DEFAULT NULL,
  `PERMANENT_THANA` varchar(300) DEFAULT NULL,
  `PERMANENT_DISTRICT` varchar(300) DEFAULT NULL,
  `PRESENT_VILLAGE` varchar(300) DEFAULT NULL,
  `PRESENT_POST` varchar(300) DEFAULT NULL,
  `PRESENT_THANA` varchar(300) DEFAULT NULL,
  `PRESENT_DISTRICT` varchar(300) DEFAULT NULL,
  `EMGRCNY_PERSON` varchar(300) DEFAULT NULL,
  `EMGRCNY_RELATION` varchar(50) DEFAULT NULL,
  `EMGRCNY_ADDRESS` varchar(255) DEFAULT NULL,
  `EMGRCNY_PHONE` varchar(20) DEFAULT NULL,
  `FATHER_NAME` varchar(300) DEFAULT NULL,
  `FATHER_PHONE` varchar(20) DEFAULT NULL,
  `MOTHER_NAME` varchar(300) DEFAULT NULL,
  `MOTHER_PHONE` varchar(20) DEFAULT NULL,
  `SPOUSE_NAME` varchar(300) DEFAULT NULL,
  `SPOSE_MARRIAGE_DATE` date DEFAULT NULL,
  `SPOSE_OCCUPATION` varchar(300) DEFAULT NULL,
  `SPOUSE_PHONE` varchar(30) DEFAULT NULL,
  `GRNT_NAME` varchar(300) DEFAULT NULL,
  `GRNT_RELE` varchar(100) DEFAULT NULL,
  `GRNT_FATHER` varchar(300) DEFAULT NULL,
  `GRNT_PRESENT_ADD` varchar(255) DEFAULT NULL,
  `GRNT_PERMANET_ADD` varchar(255) DEFAULT NULL,
  `GRNT_NATIONALITY` varchar(50) DEFAULT NULL,
  `GRNT_PROFFESSION` varchar(300) DEFAULT NULL,
  `GRNT_NID` varchar(30) DEFAULT NULL,
  `GRNT_MOBILE` varchar(20) DEFAULT NULL,
  `CREATED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UPDATED_AT` datetime DEFAULT NULL,
  PRIMARY KEY (`EMP_ENTRY_ID`),
  UNIQUE KEY `UK_EMP_BATCH_MERIT_CLASS` (`batch_no`(50),`MERITLIST_ID`(50),`CLASS_ID`(50)),
  UNIQUE KEY `UK_EMP_IPI` (`IPI`),
  KEY `IX_UP_EMP_BATCH` (`batch_no`),
  KEY `IX_EMP_VERIFY` (`MERITLIST_ID`(50),`CLASS_ID`(50),`PHONE`),
  KEY `IX_UP_EMP_APPROVAL` (`APPROVAL_STATUS`),
  CONSTRAINT `FK_UP_EMP_BATCH`
    FOREIGN KEY (`batch_no`) REFERENCES `hr_batch_control` (`BATCH_NO`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `up_emp`
(`EMP_ENTRY_ID`,`MERITLIST_ID`,`CLASS_ID`,`IPI`,`APPROVAL_STATUS`,`APPROVED_BY`,`APPROVED_AT`,`NAME`,`batch_no`,`BIRTHDATE`,`BLD_GROUP`,`GENDER`,`RELIGION`,`NATIONALITY`,`MARITAL_STATUS`,`EMAIL`,`PHONE`,`PHONE1`,`HEIGHT`,`WEIGHT`,`NID`,`PERMANENT_VILLAGE`,`PERMANENT_POST`,`PERMANENT_THANA`,`PERMANENT_DISTRICT`,`PRESENT_VILLAGE`,`PRESENT_POST`,`PRESENT_THANA`,`PRESENT_DISTRICT`,`EMGRCNY_PERSON`,`EMGRCNY_RELATION`,`EMGRCNY_ADDRESS`,`EMGRCNY_PHONE`,`FATHER_NAME`,`FATHER_PHONE`,`MOTHER_NAME`,`MOTHER_PHONE`,`SPOUSE_NAME`,`SPOSE_MARRIAGE_DATE`,`SPOSE_OCCUPATION`,`SPOUSE_PHONE`,`GRNT_NAME`,`GRNT_RELE`,`GRNT_FATHER`,`GRNT_PRESENT_ADD`,`GRNT_PERMANET_ADD`,`GRNT_NATIONALITY`,`GRNT_PROFFESSION`,`GRNT_NID`,`GRNT_MOBILE`,`CREATED_AT`,`UPDATED_AT`)
VALUES
(1,'101','01','IPI-009129','APPROVED','sadiq','2026-08-27 12:55:21','Md. Sadiqur Rahman','BATCH-2026-01','1997-12-30','AB-','M','I','Bangladeshi','U','shadiqur.it@gmail.com','01996200797','01709645125','5'' 3"','62kg','4203692415','Baniabari','Mahmudpur','Melandaha','Jamalpur','Baniabari','Mahmudpur','Melandaha','Jamalpur','Ataur Rahman','Father',NULL,'01728183469','Ataur Rahman','01728183469','Sawda Begum','01728183469','Arafat Jahan','2007-12-09','Student','01996200797','Ataur Rahman','Father','AB Samad Mondol','Baniabari, Mahmudpur, Melandaha, Jamalpur','Baniabari, Mahmudpur, Melandaha, Jamalpur','Bangladeshi',NULL,NULL,NULL,'2026-08-27 12:17:40','2026-08-30 16:32:54'),
(2,'1','1',NULL,'APPROVED','sadiq','2026-08-30 04:02:52','Mahmud hasan','BATCH-2026-01','2026-08-21','B+','M','I','Bangladesh','M','mahmudhasanalam91@gmail.com','01709649354','01918589368','5.5','56 kg','7772522400','Chackbara','Hainbari','Shyamanagar','Satkhira','Chackbara','Hainbari','Shyamanagar','Satkhira','Samim','Brother','3 Asadgate, Tanin Center, Mihammadpur, Dhaka','01709649364','Mostafa shahidullah','01912379624','Saleha khatun','01954381368','Sayedatun Neaa','2026-08-28','Nurse','01779133646','Mostafa shahidullah','Father','Nojib mollah','3 Asadgate, Tanin Center, Mihammadpur, Dhaka','Bosila','4448882920','Business','9999yywiwi2','01012379624','2026-08-30 03:20:57','2026-08-30 04:02:52');

ALTER TABLE `up_emp` AUTO_INCREMENT = 5;

-- ------------------------------------------------------------
-- hr_empfamilydet
-- ------------------------------------------------------------
CREATE TABLE `hr_empfamilydet` (
  `FAMILY_ID` bigint NOT NULL AUTO_INCREMENT,
  `EMP_ENTRY_ID` bigint NOT NULL,
  `EMPCODE` varchar(50) DEFAULT NULL,
  `FNAME` varchar(100) DEFAULT NULL,
  `F_OCUP` varchar(70) DEFAULT NULL,
  `F_ADD` varchar(100) DEFAULT NULL,
  `PHONE` varchar(25) DEFAULT NULL,
  `CHILD_NOS` int NOT NULL,
  `BIRTH_DATE` date DEFAULT NULL,
  PRIMARY KEY (`FAMILY_ID`),
  UNIQUE KEY `UK_FAMILY_ENTRY_CHILD` (`EMP_ENTRY_ID`,`CHILD_NOS`),
  KEY `IX_FAMILY_EMPCODE` (`EMPCODE`),
  CONSTRAINT `FK_FAMILY_EMP_ENTRY`
    FOREIGN KEY (`EMP_ENTRY_ID`) REFERENCES `up_emp` (`EMP_ENTRY_ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- hr_empexamdet
-- ------------------------------------------------------------
CREATE TABLE `hr_empexamdet` (
  `SLNO` bigint NOT NULL,
  `EMP_ENTRY_ID` bigint NOT NULL,
  `EMPCODE` varchar(50) DEFAULT NULL,
  `EXAMNAME` varchar(170) DEFAULT NULL,
  `EXAMGROUP` varchar(170) DEFAULT NULL,
  `BOARD` varchar(1000) DEFAULT NULL,
  `CLAS` varchar(300) DEFAULT NULL,
  `PASSYEAR` varchar(100) DEFAULT NULL,
  `REMARKS` varchar(100) DEFAULT NULL,
  `INSTITUTE` varchar(500) DEFAULT NULL,
  `SUBJECT_NAME` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`EMP_ENTRY_ID`,`SLNO`),
  KEY `IX_EXAM_ENTRY` (`EMP_ENTRY_ID`),
  KEY `IX_EXAM_EMPCODE` (`EMPCODE`),
  CONSTRAINT `FK_EXAM_EMP_ENTRY`
    FOREIGN KEY (`EMP_ENTRY_ID`) REFERENCES `up_emp` (`EMP_ENTRY_ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `hr_empexamdet`
(`SLNO`,`EMP_ENTRY_ID`,`EMPCODE`,`EXAMNAME`,`EXAMGROUP`,`BOARD`,`CLAS`,`PASSYEAR`,`REMARKS`,`INSTITUTE`,`SUBJECT_NAME`)
VALUES
(1,1,'IPI-009129','SSC / Dakhil','General','Madrasah','4.56','2012',NULL,NULL,NULL),
(1,2,NULL,'SSC / Dakhil','Science','Jeshore','R.18','2006','Ok','Satkhira','Science');

-- ------------------------------------------------------------
-- hr_update_request
-- ------------------------------------------------------------
CREATE TABLE `hr_update_request` (
  `REQUEST_ID` char(36) NOT NULL,
  `EMP_ENTRY_ID` bigint NOT NULL,
  `IPI` varchar(50) DEFAULT NULL,
  `MERITLIST_ID` varchar(100) NOT NULL,
  `CLASS_ID` varchar(100) NOT NULL,
  `BATCH_NO` varchar(100) NOT NULL,
  `REQUEST_NOTE` varchar(1000) DEFAULT NULL,
  `REQUESTED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `STATUS` enum('PENDING','APPROVED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `APPROVED_AT` datetime DEFAULT NULL,
  `APPROVED_UNTIL` datetime DEFAULT NULL,
  `APPROVED_BY` varchar(150) DEFAULT NULL,
  `ADMIN_REMARKS` varchar(1000) DEFAULT NULL,
  `UPDATED_AT` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`REQUEST_ID`),
  KEY `IX_REQ_ENTRY_STATUS` (`EMP_ENTRY_ID`,`STATUS`),
  KEY `IX_REQ_APPROVED_UNTIL` (`APPROVED_UNTIL`),
  KEY `FK_REQ_BATCH` (`BATCH_NO`),
  CONSTRAINT `FK_REQ_BATCH`
    FOREIGN KEY (`BATCH_NO`) REFERENCES `hr_batch_control` (`BATCH_NO`),
  CONSTRAINT `FK_REQ_EMP_ENTRY`
    FOREIGN KEY (`EMP_ENTRY_ID`) REFERENCES `up_emp` (`EMP_ENTRY_ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET UNIQUE_CHECKS = 1;
SET FOREIGN_KEY_CHECKS = 1;

-- End of compatible full dump
