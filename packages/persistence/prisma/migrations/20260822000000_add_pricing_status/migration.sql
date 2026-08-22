-- AlterTable
ALTER TABLE "ModelRoute" ADD COLUMN "pricing_status" TEXT NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "ModelOffering" ADD COLUMN "pricing_status" TEXT NOT NULL DEFAULT 'unknown';
