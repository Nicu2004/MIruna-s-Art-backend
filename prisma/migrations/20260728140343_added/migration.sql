-- CreateTable
CREATE TABLE `exhibitions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `exhibition_title` VARCHAR(191) NOT NULL,
    `exhibition_date` DATETIME(3) NOT NULL,
    `exhibition_location` VARCHAR(191) NOT NULL,
    `exhibition_description` VARCHAR(191) NOT NULL,
    `exhibition_status` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
