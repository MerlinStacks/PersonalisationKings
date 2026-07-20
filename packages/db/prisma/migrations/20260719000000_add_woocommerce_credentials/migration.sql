-- AlterTable
ALTER TABLE "Store"
ADD COLUMN "connectionLastCheckedAt" TIMESTAMP(3),
ADD COLUMN "connectionLastSuccessfulAt" TIMESTAMP(3),
ADD COLUMN "connectionLastFailedAt" TIMESTAMP(3),
ADD COLUMN "connectionLastError" TEXT,
ADD COLUMN "connectionRevokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StoreCredential" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "externalKeyId" TEXT,
    "permissions" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WooCommerceAuthAttempt" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "callbackReceivedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnSucceeded" BOOLEAN,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WooCommerceAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreCredential_storeId_merchantId_key" ON "StoreCredential"("storeId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_merchantId_type_url_key" ON "Store"("merchantId", "type", "url");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCredential_id_merchantId_key" ON "StoreCredential"("id", "merchantId");

-- CreateIndex
CREATE INDEX "StoreCredential_merchantId_idx" ON "StoreCredential"("merchantId");

-- CreateIndex
CREATE INDEX "WooCommerceAuthAttempt_merchantId_expiresAt_idx" ON "WooCommerceAuthAttempt"("merchantId", "expiresAt");

-- CreateIndex
CREATE INDEX "WooCommerceAuthAttempt_storeId_createdAt_idx" ON "WooCommerceAuthAttempt"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreCredential" ADD CONSTRAINT "StoreCredential_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WooCommerceAuthAttempt" ADD CONSTRAINT "WooCommerceAuthAttempt_storeId_merchantId_fkey" FOREIGN KEY ("storeId", "merchantId") REFERENCES "Store"("id", "merchantId") ON DELETE CASCADE ON UPDATE CASCADE;
