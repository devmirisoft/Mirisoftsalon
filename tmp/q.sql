\x
SELECT i.id, i.status, i."paymentStatus", i."paidAmount", i."appointmentId",
       a.status AS appt_status, a."walkInJobCart", a.source
FROM "Invoice" i
LEFT JOIN "Appointment" a ON a.id = i."appointmentId"
WHERE i.id = '06d5a4c2-bcca-402f-b802-88417bf6125c';
