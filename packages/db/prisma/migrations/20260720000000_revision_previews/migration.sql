-- AlterTable
ALTER TABLE "CustomisationSession" DROP COLUMN "previewAssetId";

-- AlterTable
ALTER TABLE "CustomisationRevision" ADD COLUMN "previewAssetVersionId" TEXT;

-- CreateIndex
CREATE INDEX "CustomisationRevision_previewAssetVersionId_merchantId_idx" ON "CustomisationRevision"("previewAssetVersionId", "merchantId");

-- AddForeignKey
ALTER TABLE "CustomisationRevision" ADD CONSTRAINT "CustomisationRevision_previewAssetVersionId_merchantId_fkey" FOREIGN KEY ("previewAssetVersionId", "merchantId") REFERENCES "AssetVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;
