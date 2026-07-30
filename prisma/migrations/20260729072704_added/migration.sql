/*
  Warnings:

  - Added the required column `view_enabled` to the `exhibitions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `exhibitions` ADD COLUMN `view_enabled` BOOLEAN NOT NULL;
