-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('woocommerce', 'shopify');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('pending', 'connected', 'disconnected', 'revoked', 'failed');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('owner_admin', 'designer', 'production_operator', 'support', 'auditor');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('font', 'artwork', 'clipart', 'upload', 'mockup', 'preview', 'production_artifact');

-- CreateEnum
CREATE TYPE "AssetValidationStatus" AS ENUM ('pending', 'accepted', 'rejected', 'quarantined', 'deleted');

-- CreateEnum
CREATE TYPE "CustomisationStatus" AS ENUM ('draft', 'committed', 'ordered', 'ready', 'needs_review', 'failed', 'cancelled', 'archived');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('queued', 'running', 'ready', 'needs_review', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "temporaryUploadRetentionDays" INTEGER NOT NULL DEFAULT 15,
    "previewRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "productionArtifactRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "StoreType" NOT NULL,
    "url" TEXT NOT NULL,
    "externalStoreId" TEXT,
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'pending',
    "webhookSigningKeyId" TEXT,
    "webhookSecretEncrypted" TEXT,
    "credentialReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "externalVariantKey" TEXT NOT NULL DEFAULT '',
    "designId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignVersion" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sceneGraph" JSONB NOT NULL,
    "customiserConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "validationStatus" "AssetValidationStatus" NOT NULL DEFAULT 'pending',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputProfile" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutputProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutputProfileVersion" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "outputProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "printerModel" TEXT NOT NULL,
    "ripName" TEXT NOT NULL,
    "ripVersion" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL DEFAULT 'pdf',
    "widthUm" INTEGER NOT NULL,
    "heightUm" INTEGER NOT NULL,
    "bleedUm" INTEGER NOT NULL DEFAULT 0,
    "processColourSpace" TEXT NOT NULL,
    "whiteSpotName" TEXT NOT NULL DEFAULT 'RDG_WHITE',
    "glossSpotName" TEXT NOT NULL DEFAULT 'RDG_Gloss',
    "inkSequence" JSONB NOT NULL,
    "overprintPolicy" JSONB NOT NULL,
    "whiteMaskPolicy" JSONB NOT NULL,
    "glossMaskPolicy" JSONB NOT NULL,
    "preflightRuleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutputProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomisationSession" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "customerInputs" JSONB NOT NULL,
    "renderSpec" JSONB,
    "previewAssetId" TEXT,
    "status" "CustomisationStatus" NOT NULL DEFAULT 'draft',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomisationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomisationRevision" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "opaqueReference" TEXT NOT NULL,
    "customerInputs" JSONB NOT NULL,
    "renderSpec" JSONB NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomisationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalOrder" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "externalOrderNumber" TEXT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcommerceLineItem" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "externalLineItemId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "externalVariantId" TEXT,
    "quantity" INTEGER NOT NULL,
    "customisationRevisionId" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "EcommerceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderArtworkSnapshot" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customisationRevisionId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "outputProfileVersionId" TEXT NOT NULL,
    "renderSpecSchemaVersion" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderArtworkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "artworkSnapshotId" TEXT NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'queued',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJobAttempt" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "printJobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "PrintJobStatus" NOT NULL,
    "logs" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedArtifact" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "printJobAttemptId" TEXT NOT NULL,
    "outputProfileVersionId" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "preflightStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" TEXT NOT NULL,
    "connectorInstanceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "contentDigest" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "liveDeletedAt" TIMESTAMP(3),
    "backupExpiryNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");

-- CreateIndex
CREATE INDEX "StaffUser_merchantId_role_idx" ON "StaffUser"("merchantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_merchantId_email_key" ON "StaffUser"("merchantId", "email");

-- CreateIndex
CREATE INDEX "Store_merchantId_type_idx" ON "Store"("merchantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Store_id_merchantId_key" ON "Store"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_id_webhookSigningKeyId_key" ON "Store"("id", "webhookSigningKeyId");

-- CreateIndex
CREATE INDEX "ProductMapping_merchantId_active_idx" ON "ProductMapping"("merchantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_storeId_externalProductId_externalVariantKey_key" ON "ProductMapping"("storeId", "externalProductId", "externalVariantKey");

-- CreateIndex
CREATE INDEX "Design_merchantId_archivedAt_idx" ON "Design"("merchantId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Design_id_merchantId_key" ON "Design"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Design_currentVersionId_id_key" ON "Design"("currentVersionId", "id");

-- CreateIndex
CREATE INDEX "DesignVersion_merchantId_designId_idx" ON "DesignVersion"("merchantId", "designId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignVersion_designId_version_key" ON "DesignVersion"("designId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DesignVersion_id_designId_key" ON "DesignVersion"("id", "designId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignVersion_id_merchantId_key" ON "DesignVersion"("id", "merchantId");

-- CreateIndex
CREATE INDEX "Asset_merchantId_kind_idx" ON "Asset"("merchantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_id_merchantId_key" ON "Asset"("id", "merchantId");

-- CreateIndex
CREATE INDEX "AssetVersion_merchantId_validationStatus_idx" ON "AssetVersion"("merchantId", "validationStatus");

-- CreateIndex
CREATE INDEX "AssetVersion_objectKey_idx" ON "AssetVersion"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_id_merchantId_key" ON "AssetVersion"("id", "merchantId");

-- CreateIndex
CREATE INDEX "OutputProfile_merchantId_idx" ON "OutputProfile"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputProfile_id_merchantId_key" ON "OutputProfile"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputProfile_activeVersionId_id_key" ON "OutputProfile"("activeVersionId", "id");

-- CreateIndex
CREATE INDEX "OutputProfileVersion_merchantId_outputProfileId_idx" ON "OutputProfileVersion"("merchantId", "outputProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputProfileVersion_outputProfileId_version_key" ON "OutputProfileVersion"("outputProfileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OutputProfileVersion_id_outputProfileId_key" ON "OutputProfileVersion"("id", "outputProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "OutputProfileVersion_id_merchantId_key" ON "OutputProfileVersion"("id", "merchantId");

-- CreateIndex
CREATE INDEX "CustomisationSession_merchantId_status_idx" ON "CustomisationSession"("merchantId", "status");

-- CreateIndex
CREATE INDEX "CustomisationSession_storeId_externalProductId_externalVari_idx" ON "CustomisationSession"("storeId", "externalProductId", "externalVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomisationSession_id_merchantId_key" ON "CustomisationSession"("id", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomisationRevision_opaqueReference_key" ON "CustomisationRevision"("opaqueReference");

-- CreateIndex
CREATE INDEX "CustomisationRevision_merchantId_committedAt_idx" ON "CustomisationRevision"("merchantId", "committedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomisationRevision_sessionId_revision_key" ON "CustomisationRevision"("sessionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CustomisationRevision_id_merchantId_key" ON "CustomisationRevision"("id", "merchantId");

-- CreateIndex
CREATE INDEX "ExternalOrder_merchantId_status_idx" ON "ExternalOrder"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalOrder_storeId_externalOrderId_key" ON "ExternalOrder"("storeId", "externalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalOrder_id_merchantId_key" ON "ExternalOrder"("id", "merchantId");

-- CreateIndex
CREATE INDEX "EcommerceLineItem_merchantId_externalProductId_externalVari_idx" ON "EcommerceLineItem"("merchantId", "externalProductId", "externalVariantId");

-- CreateIndex
CREATE INDEX "EcommerceLineItem_customisationRevisionId_idx" ON "EcommerceLineItem"("customisationRevisionId");

-- CreateIndex
CREATE INDEX "OrderArtworkSnapshot_merchantId_createdAt_idx" ON "OrderArtworkSnapshot"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_merchantId_status_idx" ON "PrintJob"("merchantId", "status");

-- CreateIndex
CREATE INDEX "PrintJobAttempt_merchantId_status_idx" ON "PrintJobAttempt"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJobAttempt_printJobId_attemptNumber_key" ON "PrintJobAttempt"("printJobId", "attemptNumber");

-- CreateIndex
CREATE INDEX "GeneratedArtifact_merchantId_artifactType_idx" ON "GeneratedArtifact"("merchantId", "artifactType");

-- CreateIndex
CREATE INDEX "WebhookDelivery_merchantId_processedAt_idx" ON "WebhookDelivery"("merchantId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_storeId_eventId_key" ON "WebhookDelivery"("storeId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_storeId_idempotencyKey_key" ON "WebhookDelivery"("storeId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_storeId_nonce_key" ON "WebhookDelivery"("storeId", "nonce");

-- CreateIndex
CREATE INDEX "OutboxEvent_merchantId_dispatchedAt_createdAt_idx" ON "OutboxEvent"("merchantId", "dispatchedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_merchantId_action_createdAt_idx" ON "AuditEvent"("merchantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "DeletionRequest_merchantId_status_idx" ON "DeletionRequest"("merchantId", "status");

-- AddForeignKey
ALTER TABLE "MerchantSettings" ADD CONSTRAINT "MerchantSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_designId_merchantId_fkey" FOREIGN KEY ("designId", "merchantId") REFERENCES "Design"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_currentVersionId_id_fkey" FOREIGN KEY ("currentVersionId", "id") REFERENCES "DesignVersion"("id", "designId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_designId_merchantId_fkey" FOREIGN KEY ("designId", "merchantId") REFERENCES "Design"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_merchantId_fkey" FOREIGN KEY ("assetId", "merchantId") REFERENCES "Asset"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputProfile" ADD CONSTRAINT "OutputProfile_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputProfile" ADD CONSTRAINT "OutputProfile_activeVersionId_id_fkey" FOREIGN KEY ("activeVersionId", "id") REFERENCES "OutputProfileVersion"("id", "outputProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutputProfileVersion" ADD CONSTRAINT "OutputProfileVersion_outputProfileId_merchantId_fkey" FOREIGN KEY ("outputProfileId", "merchantId") REFERENCES "OutputProfile"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomisationSession" ADD CONSTRAINT "CustomisationSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomisationSession" ADD CONSTRAINT "CustomisationSession_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomisationSession" ADD CONSTRAINT "CustomisationSession_designId_merchantId_fkey" FOREIGN KEY ("designId", "merchantId") REFERENCES "Design"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomisationRevision" ADD CONSTRAINT "CustomisationRevision_sessionId_merchantId_fkey" FOREIGN KEY ("sessionId", "merchantId") REFERENCES "CustomisationSession"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomisationRevision" ADD CONSTRAINT "CustomisationRevision_designVersionId_merchantId_fkey" FOREIGN KEY ("designVersionId", "merchantId") REFERENCES "DesignVersion"("id", "merchantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalOrder" ADD CONSTRAINT "ExternalOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalOrder" ADD CONSTRAINT "ExternalOrder_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceLineItem" ADD CONSTRAINT "EcommerceLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ExternalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcommerceLineItem" ADD CONSTRAINT "EcommerceLineItem_customisationRevisionId_fkey" FOREIGN KEY ("customisationRevisionId") REFERENCES "CustomisationRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_customisationRevisionId_fkey" FOREIGN KEY ("customisationRevisionId") REFERENCES "CustomisationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "DesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderArtworkSnapshot" ADD CONSTRAINT "OrderArtworkSnapshot_outputProfileVersionId_fkey" FOREIGN KEY ("outputProfileVersionId") REFERENCES "OutputProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ExternalOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_artworkSnapshotId_fkey" FOREIGN KEY ("artworkSnapshotId") REFERENCES "OrderArtworkSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJobAttempt" ADD CONSTRAINT "PrintJobAttempt_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_printJobAttemptId_fkey" FOREIGN KEY ("printJobAttemptId") REFERENCES "PrintJobAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedArtifact" ADD CONSTRAINT "GeneratedArtifact_outputProfileVersionId_fkey" FOREIGN KEY ("outputProfileVersionId") REFERENCES "OutputProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletionRequest" ADD CONSTRAINT "DeletionRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
