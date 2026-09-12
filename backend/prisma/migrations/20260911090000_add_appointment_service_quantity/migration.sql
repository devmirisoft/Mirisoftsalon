-- Service lines on a job cart can be billed more than once (two haircuts for
-- one visit), so each line carries its own quantity instead of needing a
-- duplicate row per unit.
ALTER TABLE "AppointmentService" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
