import { encryptStoreWebhookSecret, hashPassword } from "@personalise-kings/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demoPasswordHash = await hashPassword("password123");
  if (process.env.NODE_ENV === "production" && (!process.env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY || !process.env.PK_DEMO_CONNECTOR_SECRET)) {
    throw new Error("Production seed requires explicit connector encryption and demo signing secrets");
  }
  const connectorEncryptionKey = process.env.PK_CONNECTOR_SECRET_ENCRYPTION_KEY ?? Buffer.alloc(32, 1).toString("base64");
  const connectorSecret = process.env.PK_DEMO_CONNECTOR_SECRET ?? "dev-connector-secret-change-me";
  const demoKeyId = "demo-key";
  const encryptedDemoSecret = encryptStoreWebhookSecret(connectorSecret, connectorEncryptionKey, "seed-store", demoKeyId);

  const merchant = await prisma.merchant.upsert({
    where: { id: "seed-merchant" },
    update: {},
    create: {
      id: "seed-merchant",
      name: "PersonaliseKings Demo"
    }
  });

  await prisma.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: {
      merchantId: merchant.id,
      temporaryUploadRetentionDays: 15,
      previewRetentionDays: 30,
      productionArtifactRetentionDays: 90
    }
  });

  await prisma.staffUser.upsert({
    where: { merchantId_email: { merchantId: merchant.id, email: "owner@example.test" } },
    update: { passwordHash: demoPasswordHash },
    create: {
      merchantId: merchant.id,
      email: "owner@example.test",
      passwordHash: demoPasswordHash,
      role: "owner_admin"
    }
  });

  const store = await prisma.store.upsert({
    where: { id: "seed-store" },
    update: {
      webhookSigningKeyId: demoKeyId,
      webhookSecretEncrypted: encryptedDemoSecret,
      activeWebhookSigningKeyId: demoKeyId
    },
    create: {
      id: "seed-store",
      merchantId: merchant.id,
      type: "woocommerce",
      url: "https://example.test",
      externalStoreId: "demo-woo",
      connectionStatus: "connected",
      webhookSigningKeyId: demoKeyId,
      webhookSecretEncrypted: encryptedDemoSecret,
      activeWebhookSigningKeyId: demoKeyId
    }
  });
  await prisma.storeWebhookSigningKey.upsert({
    where: { storeId_keyId: { storeId: store.id, keyId: demoKeyId } },
    update: { secretEncrypted: encryptedDemoSecret, retiredAt: null, revokedAt: null },
    create: { merchantId: merchant.id, storeId: store.id, keyId: demoKeyId, secretEncrypted: encryptedDemoSecret }
  });

  const fontAsset = await prisma.asset.upsert({
    where: { id: "demo-font" },
    update: {},
    create: { id: "demo-font", merchantId: merchant.id, kind: "font", name: "Demo font" }
  });
  await prisma.assetVersion.upsert({
    where: { id: "demo-font-version" },
    update: {},
    create: {
      id: "demo-font-version",
      merchantId: merchant.id,
      assetId: fontAsset.id,
      version: 1,
      objectKey: "merchant_design_asset/seed-merchant/demo-font-version",
      checksumSha256: "0".repeat(64),
      byteSize: 0,
      contentType: "font/woff2",
      validationStatus: "accepted"
    }
  });

  const design = await prisma.design.upsert({
    where: { id: "seed-design" },
    update: {},
    create: {
      id: "seed-design",
      merchantId: merchant.id,
      name: "Demo UV Print Design"
    }
  });

  const demoSceneGraph = {
    schemaVersion: "scene-graph.v1",
    coordinateSystem: "micrometres",
    printArea: { widthUm: 100000, heightUm: 70000 },
    layers: [
      {
        id: "text-1",
        type: "text",
        name: "Customer name",
        transform: {
          translateXUm: 12000,
          translateYUm: 32000,
          scaleXPermille: 1000,
          scaleYPermille: 1000,
          rotationMilliDegrees: 0
        },
        text: "Your text",
        fontAssetVersionId: "demo-font-version",
        fontSizeUm: 9000,
        fill: "#17201a",
        opacityPermille: 1000
      }
    ]
  };
  const demoCustomiserConfig = {
    schemaVersion: "customiser-config.v1",
    layers: [{
      layerId: "text-1",
      type: "text",
      maxLength: 40,
      allowedColours: ["#17201a", "#145a42", "#b8462c", "#245f8f"],
      allowFontSize: true,
      minimumFontSizeUm: 5000,
      maximumFontSizeUm: 14000,
      transform: { position: true, scale: true, rotation: true }
    }]
  };

  const designVersion = await prisma.designVersion.upsert({
    where: { designId_version: { designId: design.id, version: 1 } },
    update: { sceneGraph: demoSceneGraph, customiserConfig: demoCustomiserConfig },
    create: {
      merchantId: merchant.id,
      designId: design.id,
      version: 1,
      sceneGraph: demoSceneGraph,
      customiserConfig: demoCustomiserConfig
    }
  });

  await prisma.design.update({
    where: { id: design.id },
    data: { currentVersionId: designVersion.id }
  });

  await prisma.productMapping.upsert({
    where: {
      storeId_externalProductId_externalVariantKey: {
        storeId: store.id,
        externalProductId: "demo-product",
        externalVariantKey: "demo-variant"
      }
    },
    update: { priceModifierMinor: 0 },
    create: {
      merchantId: merchant.id,
      storeId: store.id,
      externalProductId: "demo-product",
      externalVariantId: "demo-variant",
      externalVariantKey: "demo-variant",
      designId: design.id,
      priceModifierMinor: 0,
      active: true
    }
  });

  const outputProfile = await prisma.outputProfile.upsert({
    where: { id: "seed-output-profile" },
    update: {},
    create: {
      id: "seed-output-profile",
      merchantId: merchant.id,
      name: "Demo UV PDF Profile"
    }
  });

  const outputProfileVersion = await prisma.outputProfileVersion.upsert({
    where: { outputProfileId_version: { outputProfileId: outputProfile.id, version: 1 } },
    update: {},
    create: {
      merchantId: merchant.id,
      outputProfileId: outputProfile.id,
      version: 1,
      printerModel: "Phase 0 target printer pending",
      ripName: "Phase 0 RIP pending",
      ripVersion: "pending",
      outputFormat: "pdf",
      widthUm: 100000,
      heightUm: 70000,
      bleedUm: 0,
      processColourSpace: "CMYK",
      whiteSpotName: "RDG_WHITE",
      glossSpotName: "RDG_Gloss",
      inkSequence: ["process", "RDG_WHITE", "RDG_Gloss"],
      overprintPolicy: { verified: false },
      whiteMaskPolicy: { mode: "eligible_layer_alpha", verified: false },
      glossMaskPolicy: { mode: "tagged_objects", verified: false },
      preflightRuleVersion: "uv-preflight.v0"
    }
  });

  await prisma.outputProfile.update({
    where: { id: outputProfile.id },
    data: { activeVersionId: outputProfileVersion.id }
  });

  console.log(`Seeded merchant ${merchant.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
