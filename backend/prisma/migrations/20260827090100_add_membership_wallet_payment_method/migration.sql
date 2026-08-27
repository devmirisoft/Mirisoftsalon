-- Bills settled from a membership wallet are recorded as payments with their
-- own method, so invoice settlement reuses the normal payment path.
-- Kept in its own migration because ALTER TYPE ... ADD VALUE cannot be used
-- in the same transaction that later references the new value.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MEMBERSHIP_WALLET';
