ALTER TABLE "AppointmentService" ADD COLUMN "staffId" TEXT;

ALTER TABLE "AppointmentService"
  ADD CONSTRAINT "AppointmentService_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AppointmentService_staffId_idx" ON "AppointmentService"("staffId");
