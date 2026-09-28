ALTER TABLE "Appointment" ADD COLUMN "sourceAppointmentId" TEXT;

CREATE UNIQUE INDEX "Appointment_sourceAppointmentId_key"
ON "Appointment"("sourceAppointmentId");

CREATE INDEX "Appointment_sourceAppointmentId_idx"
ON "Appointment"("sourceAppointmentId");

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_sourceAppointmentId_fkey"
FOREIGN KEY ("sourceAppointmentId") REFERENCES "Appointment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
