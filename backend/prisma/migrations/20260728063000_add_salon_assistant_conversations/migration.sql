CREATE TYPE "SalonAssistantSenderType" AS ENUM ('USER', 'ASSISTANT');

CREATE TYPE "SalonAssistantMessageStatus" AS ENUM ('STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "SalonAssistantConversation" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Salon assistant',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SalonAssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalonAssistantMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderType" "SalonAssistantSenderType" NOT NULL,
  "content" TEXT NOT NULL,
  "status" "SalonAssistantMessageStatus" NOT NULL DEFAULT 'COMPLETED',
  "provider" TEXT,
  "model" TEXT,
  "promptVersion" TEXT,
  "usedFallback" BOOLEAN,
  "errorCode" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SalonAssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalonAssistantConversation_salonId_updatedAt_idx" ON "SalonAssistantConversation"("salonId", "updatedAt");
CREATE INDEX "SalonAssistantConversation_createdById_idx" ON "SalonAssistantConversation"("createdById");
CREATE INDEX "SalonAssistantMessage_conversationId_createdAt_idx" ON "SalonAssistantMessage"("conversationId", "createdAt");
CREATE INDEX "SalonAssistantMessage_createdById_idx" ON "SalonAssistantMessage"("createdById");

ALTER TABLE "SalonAssistantConversation" ADD CONSTRAINT "SalonAssistantConversation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalonAssistantConversation" ADD CONSTRAINT "SalonAssistantConversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalonAssistantMessage" ADD CONSTRAINT "SalonAssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SalonAssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalonAssistantMessage" ADD CONSTRAINT "SalonAssistantMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
