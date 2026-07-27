/*
  Warnings:

  - You are about to drop the column `us_admin` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `users` DROP COLUMN `us_admin`,
    ADD COLUMN `is_admin` BOOLEAN NOT NULL DEFAULT false;
